import { useState, useCallback, useRef } from 'react';
import { compilePdf, replacePdfText } from '../utils/pdfCompiler';
import type { Annotation, PageModification, WatermarkSettings, SecuritySettings } from '../utils/pdfCompiler';
import * as pdfjsLib from 'pdfjs-dist';

export interface PDFFileState {
  name: string;
  path: string;
  data: Uint8Array;
}

export type ActiveTab = 'archivo' | 'inicio' | 'editar' | 'paginas' | 'comentarios' | 'formularios' | 'proteger' | 'ayuda';
export type ActiveTool = 'hand' | 'select' | 'text' | 'drawing' | 'shape-rect' | 'shape-circle' | 'shape-line' | 'redact' | 'signature';

interface HistoryState {
  annotations: Record<number, Annotation[]>;
  pageMods: Record<number, PageModification>;
  pageOrder: number[];
  pdfFileData?: Uint8Array;
}

export function usePDFEditor() {
  const [pdfFile, setPdfFile] = useState<PDFFileState | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [pageMods, setPageMods] = useState<Record<number, PageModification>>({});
  const [annotations, setAnnotations] = useState<Record<number, Annotation[]>>({});
  
  const [activeTab, setActiveTab] = useState<ActiveTab>('inicio');
  const [activeTool, setActiveTool] = useState<ActiveTool>('hand');
  const [selectedPage, setSelectedPage] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(100);
  
  const [isEditingAll, setIsEditingAll] = useState<boolean>(false);
  const [convertedPages, setConvertedPages] = useState<Record<number, boolean>>({});
  
  // Design properties
  const [drawColor, setDrawColor] = useState<string>('#e05307'); // Default brand/orange accent
  const [drawWidth, setDrawWidth] = useState<number>(3);
  const [fontSize, setFontSize] = useState<number>(16);
  
  // Advanced settings
  const [watermark, setWatermark] = useState<WatermarkSettings | null>(null);
  const [security, setSecurity] = useState<SecuritySettings | null>(null);
  const [savedSignatures, setSavedSignatures] = useState<string[]>([]);
  const [bookmarks, setBookmarks] = useState<Array<{ title: string; pageIndex: number }>>([]);
  
  // Undo/Redo stacks
  const historyRef = useRef<HistoryState[]>([]);
  const redoRef = useRef<HistoryState[]>([]);

  // Capture state snapshot for undo/redo
  const pushToHistory = useCallback((currentOrder = pageOrder, currentMods = pageMods, currentAnns = annotations) => {
    historyRef.current.push({
      annotations: JSON.parse(JSON.stringify(currentAnns)),
      pageMods: { ...currentMods },
      pageOrder: [...currentOrder],
      pdfFileData: pdfFile ? pdfFile.data.slice() : undefined
    });
    redoRef.current = []; // Clear redo stack on new action
  }, [pageOrder, pageMods, annotations, pdfFile]);

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    
    // Save current state to redo stack
    redoRef.current.push({
      annotations: JSON.parse(JSON.stringify(annotations)),
      pageMods: { ...pageMods },
      pageOrder: [...pageOrder],
      pdfFileData: pdfFile ? pdfFile.data.slice() : undefined
    });

    const prevState = historyRef.current.pop()!;
    setAnnotations(prevState.annotations);
    setPageMods(prevState.pageMods);
    setPageOrder(prevState.pageOrder);
    
    if (prevState.pdfFileData && pdfFile) {
      const restoredFile = { ...pdfFile, data: prevState.pdfFileData };
      setPdfFile(restoredFile);
      
      const loadingTask = pdfjsLib.getDocument({ data: prevState.pdfFileData.slice() });
      loadingTask.promise.then(newDoc => {
        setPdfDoc(newDoc);
      }).catch(err => console.error('Error restoring PDF on undo:', err));
    }
    
    // Adjust selected page if out of bounds
    if (selectedPage >= prevState.pageOrder.length) {
      setSelectedPage(Math.max(0, prevState.pageOrder.length - 1));
    }
  }, [annotations, pageMods, pageOrder, selectedPage, pdfFile]);

  const redo = useCallback(() => {
    if (redoRef.current.length === 0) return;

    // Save current state to undo stack
    historyRef.current.push({
      annotations: JSON.parse(JSON.stringify(annotations)),
      pageMods: { ...pageMods },
      pageOrder: [...pageOrder],
      pdfFileData: pdfFile ? pdfFile.data.slice() : undefined
    });

    const nextState = redoRef.current.pop()!;
    setAnnotations(nextState.annotations);
    setPageMods(nextState.pageMods);
    setPageOrder(nextState.pageOrder);

    if (nextState.pdfFileData && pdfFile) {
      const restoredFile = { ...pdfFile, data: nextState.pdfFileData };
      setPdfFile(restoredFile);
      
      const loadingTask = pdfjsLib.getDocument({ data: nextState.pdfFileData.slice() });
      loadingTask.promise.then(newDoc => {
        setPdfDoc(newDoc);
      }).catch(err => console.error('Error restoring PDF on redo:', err));
    }
  }, [annotations, pageMods, pageOrder, pdfFile]);

    // Insert Blank Page after the current page (store blank page data for compiler)
  const [blankPages, setBlankPages] = useState<Record<number, Uint8Array>>({});
  const insertBlankPage = useCallback((afterOrigIdx: number, blankPdfBytes: Uint8Array) => {
    pushToHistory();
    const newOrigIdx = pageCount;
    setBlankPages(prev => ({ ...prev, [newOrigIdx]: blankPdfBytes }));
    setPageCount(prev => prev + 1);
    setPageMods(prev => ({
      ...prev,
      [newOrigIdx]: { deleted: false, rotation: 0 }
    }));
    setPageOrder(prev => {
      const insertPos = prev.indexOf(afterOrigIdx) + 1;
      const newOrder = [...prev];
      newOrder.splice(insertPos, 0, newOrigIdx);
      return newOrder;
    });
  }, [pushToHistory, pageCount]);

  // Flatten outline helper
  const flattenOutline = async (doc: any, outlineItems: any[]): Promise<Array<{ title: string; pageIndex: number }>> => {
    const flat: Array<{ title: string; pageIndex: number }> = [];
    const traverse = async (items: any[]) => {
      for (const item of items) {
        let pageIndex = 0;
        if (typeof item.dest === 'number') {
          pageIndex = item.dest;
        } else if (Array.isArray(item.dest) && item.dest.length > 0) {
          try {
            pageIndex = await doc.getPageIndex(item.dest[0]);
          } catch {
            pageIndex = 0;
          }
        } else if (typeof item.dest === 'string') {
          try {
            const destObj = await doc.getDestination(item.dest);
            if (destObj && destObj.length > 0) {
              pageIndex = await doc.getPageIndex(destObj[0]);
            }
          } catch {
            pageIndex = 0;
          }
        }
        flat.push({ title: item.title, pageIndex });
        if (item.items && item.items.length > 0) {
          await traverse(item.items);
        }
      }
    };
    await traverse(outlineItems);
    return flat;
  };

  // Load PDF Document
  const loadPdf = useCallback((file: PDFFileState, docProxy: any) => {
    setPdfFile(file);
    setPdfDoc(docProxy);
    const totalPages = docProxy.numPages;
    setPageCount(totalPages);
    
    const initialOrder = Array.from({ length: totalPages }, (_, i) => i);
    setPageOrder(initialOrder);
    
    const initialMods: Record<number, PageModification> = {};
    initialOrder.forEach(idx => {
      initialMods[idx] = { deleted: false, rotation: 0 };
    });
    setPageMods(initialMods);
    setAnnotations({});
    setSelectedPage(0);
    setWatermark(null);
    setSecurity(null);
    setBookmarks([]);
    setIsEditingAll(false);
    setConvertedPages({});

    docProxy.getOutline().then(async (out: any) => {
      if (out && out.length > 0) {
        const flatBookmarks = await flattenOutline(docProxy, out);
        setBookmarks(flatBookmarks);
      }
    }).catch((err: any) => console.error('Error parsing document outlines:', err));
    
    historyRef.current = [];
    redoRef.current = [];
  }, []);

  // Replace text in PDF content stream (internal editing)
  const replaceDocumentText = useCallback(async (pageIndex: number, oldText: string, newText: string, targetIndex?: number): Promise<boolean> => {
    if (!pdfFile) return false;
    try {
      const newBytes = await replacePdfText(pdfFile.data, pageIndex, oldText, newText, targetIndex);
      if (!newBytes) return false;

      // Update the file data
      const updatedFile = { ...pdfFile, data: newBytes };
      setPdfFile(updatedFile);

      // Reload the PDF.js document
      const loadingTask = pdfjsLib.getDocument({ data: newBytes.slice() });
      const newDoc = await loadingTask.promise;
      setPdfDoc(newDoc);

      return true;
    } catch (e) {
      console.error('Error al reemplazar texto en content stream:', e);
      return false;
    }
  }, [pdfFile]);

  // Replace multiple texts in PDF content stream in a single batch reload
  const replaceMultipleDocumentTexts = useCallback(async (
    pageIndex: number,
    replacements: Array<{ oldText: string; newText: string; targetIndex?: number }>
  ): Promise<boolean> => {
    if (!pdfFile) return false;
    try {
      let currentBytes = pdfFile.data;
      for (const rep of replacements) {
        const newBytes = await replacePdfText(currentBytes, pageIndex, rep.oldText, rep.newText, rep.targetIndex);
        if (newBytes) {
          currentBytes = newBytes;
        }
      }

      // Update the file data
      const updatedFile = { ...pdfFile, data: currentBytes };
      setPdfFile(updatedFile);

      // Reload the PDF.js document once
      const loadingTask = pdfjsLib.getDocument({ data: currentBytes.slice() });
      const newDoc = await loadingTask.promise;
      setPdfDoc(newDoc);

      return true;
    } catch (e) {
      console.error('Error al reemplazar textos en lote:', e);
      return false;
    }
  }, [pdfFile]);

  // Close PDF
  const closePdf = useCallback(() => {
    setPdfFile(null);
    setPdfDoc(null);
    setPageCount(0);
    setPageOrder([]);
    setPageMods({});
    setAnnotations({});
    setSelectedPage(0);
    setWatermark(null);
    setSecurity(null);
    setIsEditingAll(false);
    setConvertedPages({});
    historyRef.current = [];
    redoRef.current = [];
  }, []);

  // Page Manipulations
  const rotatePage = useCallback((origIdx: number, direction: 'left' | 'right') => {
    pushToHistory();
    setPageMods(prev => {
      const currentMod = prev[origIdx] || { deleted: false, rotation: 0 };
      let newRotation = currentMod.rotation + (direction === 'right' ? 90 : -90);
      // Normalize to 0, 90, 180, 270
      if (newRotation < 0) newRotation = 270;
      if (newRotation >= 360) newRotation = 0;
      
      return {
        ...prev,
        [origIdx]: { ...currentMod, rotation: newRotation }
      };
    });
  }, [pushToHistory]);

  const deletePage = useCallback((origIdx: number) => {
    pushToHistory();
    setPageMods(prev => {
      const currentMod = prev[origIdx] || { deleted: false, rotation: 0 };
      return {
        ...prev,
        [origIdx]: { ...currentMod, deleted: true }
      };
    });
    
    // Find next valid page to display
    setPageOrder(prevOrder => {
      const newOrder = prevOrder.filter(idx => idx !== origIdx);
      if (selectedPage >= newOrder.length) {
        setSelectedPage(Math.max(0, newOrder.length - 1));
      }
      return newOrder;
    });
  }, [pushToHistory, selectedPage]);

  const reorderPages = useCallback((newOrder: number[]) => {
    pushToHistory(newOrder);
    setPageOrder(newOrder);
  }, [pushToHistory]);

  // Annotations Manipulation
  const addAnnotation = useCallback((origIdx: number, ann: Annotation) => {
    pushToHistory();
    setAnnotations(prev => {
      const pageAnns = prev[origIdx] || [];
      return {
        ...prev,
        [origIdx]: [...pageAnns, ann]
      };
    });
  }, [pushToHistory]);

  const removeAnnotation = useCallback((origIdx: number, id: string) => {
    pushToHistory();
    setAnnotations(prev => {
      const pageAnns = prev[origIdx] || [];
      return {
        ...prev,
        [origIdx]: pageAnns.filter(ann => ann.id !== id)
      };
    });
  }, [pushToHistory]);

  // Update properties of a single annotation
  const updateAnnotation = useCallback((origIdx: number, id: string, updates: Partial<Annotation>, skipHistory = false) => {
    if (!skipHistory) {
      pushToHistory();
    }
    setAnnotations(prev => {
      const pageAnns = prev[origIdx] || [];
      return {
        ...prev,
        [origIdx]: pageAnns.map(ann => ann.id === id ? { ...ann, ...updates } as Annotation : ann)
      };
    });
  }, [pushToHistory]);

  // Reorder all annotations for a page (layering)
  const reorderAnnotations = useCallback((origIdx: number, newAnns: Annotation[]) => {
    pushToHistory();
    setAnnotations(prev => ({
      ...prev,
      [origIdx]: newAnns
    }));
  }, [pushToHistory]);

  // Signature creation
  const addSavedSignature = useCallback((base64: string) => {
    setSavedSignatures(prev => [...prev, base64]);
  }, []);

  const deleteSavedSignature = useCallback((index: number) => {
    setSavedSignatures(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Bookmarks creation
  const addBookmark = useCallback((title: string, pageIndex: number) => {
    setBookmarks(prev => {
      if (prev.some(b => b.title === title && b.pageIndex === pageIndex)) return prev;
      return [...prev, { title, pageIndex }].sort((a, b) => a.pageIndex - b.pageIndex);
    });
  }, []);

  const removeBookmark = useCallback((index: number) => {
    setBookmarks(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Build/Save edited PDF
  const compileAndSave = useCallback(async (): Promise<Uint8Array | null> => {
    if (!pdfFile) return null;
    try {
      const compiledBytes = await compilePdf(
        pdfFile.data,
        pageOrder,
        pageMods,
        annotations,
        watermark,
        security,
        bookmarks
      );
      return compiledBytes;
    } catch (e) {
      console.error('Error compiling PDF:', e);
      return null;
    }
  }, [pdfFile, pageOrder, pageMods, annotations, watermark, security, bookmarks]);

  return {
    pdfFile,
    pdfDoc,
    pageCount,
    pageOrder,
    pageMods,
    annotations,
    activeTab,
    activeTool,
    selectedPage,
    zoom,
    drawColor,
    drawWidth,
    fontSize,
    watermark,
    security,
    savedSignatures,
    blankPages,
    bookmarks,
    hasUndo: historyRef.current.length > 0,
    hasRedo: redoRef.current.length > 0,
    isEditingAll,
    convertedPages,
    
    setPdfFile,
    setPdfDoc,
    setPageCount,
    setPageOrder,
    setActiveTab,
    setActiveTool,
    setSelectedPage,
    setZoom,
    setDrawColor,
    setDrawWidth,
    setFontSize,
    setWatermark,
    setSecurity,
    setBookmarks,
    setIsEditingAll,
    setConvertedPages,
    
    loadPdf,
    closePdf,
    rotatePage,
    deletePage,
    insertBlankPage,
    reorderPages,
    addAnnotation,
    removeAnnotation,
    updateAnnotation,
    reorderAnnotations,
    addSavedSignature,
    deleteSavedSignature,
    compileAndSave,
    replaceDocumentText,
    replaceMultipleDocumentTexts,
    undo,
    redo,
    addBookmark,
    removeBookmark
  };
}
