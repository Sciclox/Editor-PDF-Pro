import { useState, useEffect, useCallback } from 'react';
import { usePDFEditor } from './hooks/usePDFEditor';
import { Ribbon } from './components/Ribbon';
import { Sidebar } from './components/Sidebar';
import { Workspace } from './components/Workspace';
import { StatusBar } from './components/StatusBar';
import { MergeModal, SecurityModal, WatermarkModal, OCRModal, AlertModal } from './components/Modals';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb } from 'pdf-lib';
import { mergePdfs } from './utils/pdfCompiler';

// Robust UUID generator fallback for browser environment
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Safely and efficiently converts dynamic context-isolated data arrays to Uint8Array without freezing
function safeToUint8Array(bytes: any): Uint8Array {
  if (!bytes) return new Uint8Array();
  
  if (bytes instanceof Uint8Array) {
    return bytes;
  }

  if (bytes instanceof ArrayBuffer || (bytes.constructor && bytes.constructor.name === 'ArrayBuffer') || Object.prototype.toString.call(bytes) === '[object ArrayBuffer]') {
    return new Uint8Array(bytes);
  }
  
  // Fast path for typed array views from other V8 contexts
  if (ArrayBuffer.isView(bytes) || (bytes.constructor && bytes.constructor.name === 'Uint8Array')) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
  }
  
  // Fast path for Buffer objects: { type: 'Buffer', data: [...] }
  if (bytes.type === 'Buffer' && Array.isArray(bytes.data)) {
    return new Uint8Array(bytes.data);
  }

  // Fast path for plain objects representing array with length
  if (typeof bytes.length === 'number') {
    const len = bytes.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = bytes[i];
    }
    return arr;
  }
  
  // Fallback
  return new Uint8Array(Object.values(bytes));
}

export default function App() {
  const editor = usePDFEditor();
  
  // Custom Alert Modal state
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  // Override window.alert globally
  useEffect(() => {
    window.alert = (msg: any) => {
      setAlertMessage(msg !== undefined && msg !== null ? String(msg) : '');
    };
  }, []);
  
  // Dark mode state with persistence
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('editor-pdf-dark-mode') === 'true';
  });

  const toggleDarkMode = useCallback(() => {
    setDarkMode(prev => {
      const next = !prev;
      localStorage.setItem('editor-pdf-dark-mode', String(next));
      return next;
    });
  }, []);

  // Apply dark mode class to html element
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);
  
  // Selected signature base64 image reference
  const [selectedSignature, setSelectedSignature] = useState<string | null>(null);

  // Modals Visibility
  const [isMergeOpen, setIsMergeOpen] = useState(false);
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  const [isWatermarkOpen, setIsWatermarkOpen] = useState(false);
  const [isOCROpen, setIsOCROpen] = useState(false);

  // Expose pdfjsLib globally so Modals/OCR can access it
  useEffect(() => {
    (window as any).pdfjsLib = pdfjsLib;
  }, []);

  // Helper to handle loading a new PDF or appending it to the current one
  const handleLoadOrAppendPdf = async (file: { name: string; path: string; data: Uint8Array }) => {
    if (editor.pdfFile) {
      try {
        // 1. Compile current PDF with edits
        const currentBytes = await editor.compileAndSave();
        if (!currentBytes) {
          alert('Error al compilar el documento actual.');
          return;
        }

        // 2. Merge current bytes with new file bytes
        const mergedBytes = await mergePdfs([
          { name: editor.pdfFile.name, data: currentBytes },
          { name: file.name, data: file.data }
        ]);

        // 3. Load merged PDF
        const loadingTask = pdfjsLib.getDocument({ data: mergedBytes.slice() });
        const doc = await loadingTask.promise;
        editor.loadPdf({
          name: editor.pdfFile.name, // Keep original main name
          path: editor.pdfFile.path, // Keep original main path
          data: mergedBytes
        }, doc);
        
        alert(`Páginas de "${file.name}" añadidas automáticamente al final del documento.`);
      } catch (err: any) {
        alert('Error al combinar los PDFs: ' + err.message);
      }
      return;
    }

    // Default flow: Replace/load as new PDF
    try {
      const loadingTask = pdfjsLib.getDocument({ data: file.data.slice() });
      const doc = await loadingTask.promise;
      editor.loadPdf({
        name: file.name,
        path: file.path,
        data: file.data
      }, doc);
    } catch (err: any) {
      alert('Error al cargar el PDF: ' + err.message);
    }
  };

  // Handle Drag and Drop Files over App Shell
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
          try {
            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            await handleLoadOrAppendPdf({
              name: file.name,
              path: (file as any).path || '',
              data: bytes
            });
          } catch (err: any) {
            alert('Error al procesar el PDF arrastrado: ' + err.message);
          }
        } else {
          alert('Solo se admiten archivos en formato PDF.');
        }
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [editor.loadPdf, editor.pdfFile]);

  // Open Native PDF File Picker
  const handleOpenPdf = async () => {
    if (!window.electronAPI) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf';
      input.onchange = async (e: any) => {
        const file = e.target.files?.[0];
        if (file) {
          try {
            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            await handleLoadOrAppendPdf({
              name: file.name,
              path: '',
              data: bytes
            });
          } catch (err: any) {
            alert('Error al procesar PDF en navegador: ' + err.message);
          }
        }
      };
      input.click();
      return;
    }

    try {
      const result = await window.electronAPI.openFile();
      if (result) {
        const bytes = safeToUint8Array(result.data);

        await handleLoadOrAppendPdf({
          name: result.name,
          path: result.path,
          data: bytes
        });
      }
    } catch (e: any) {
      alert('Error al seleccionar archivo: ' + e.message);
    }
  };

  // Save changes to current file path
  const handleSavePdf = async () => {
    if (!editor.pdfFile) return;

    try {
      const bytes = await editor.compileAndSave();
      if (!bytes) {
        alert('Error al compilar el PDF.');
        return;
      }

      if (editor.pdfFile.path === '') {
        // No path (e.g. drag & drop from browser or web context), force Save As
        await handleSaveAsPdf();
        return;
      }

      const saveResult = await window.electronAPI.saveFile(editor.pdfFile.path, bytes);
      if (saveResult && saveResult.success) {
        // Update loaded data in state
        editor.setPdfFile(prev => prev ? { ...prev, data: bytes } : null);
        alert('Cambios guardados con éxito.');
      } else {
        alert('Error al guardar archivo: ' + saveResult.error);
      }
    } catch (e: any) {
      alert('Error al guardar: ' + e.message);
    }
  };

  // Save changes to new file path
  const handleSaveAsPdf = async () => {
    if (!editor.pdfFile) return;

    try {
      const bytes = await editor.compileAndSave();
      if (!bytes) {
        alert('Error al compilar el PDF.');
        return;
      }

      if (!window.electronAPI) {
        // Browser fallback: trigger download
        const blob = new Blob([bytes as any], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = editor.pdfFile.name;
        a.click();
        URL.revokeObjectURL(url);

        const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
        const doc = await loadingTask.promise;
        editor.loadPdf({
          name: editor.pdfFile.name,
          path: '',
          data: bytes
        }, doc);
        alert('Archivo descargado con éxito.');
        return;
      }

      const saveResult = await window.electronAPI.saveAs(bytes, editor.pdfFile.name);
      if (saveResult && saveResult.success && saveResult.path && saveResult.name) {
        const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
        const doc = await loadingTask.promise;
        editor.loadPdf({
          name: saveResult.name,
          path: saveResult.path,
          data: bytes
        }, doc);
        alert('Archivo guardado como nuevo documento con éxito.');
      }
    } catch (e: any) {
      alert('Error al guardar como: ' + e.message);
    }
  };

  // Trigger Print Command
  const handlePrintPdf = async () => {
    if (!editor.pdfFile) return;
    try {
      await window.electronAPI.printFile(editor.pdfFile.path);
      alert('Solicitud de impresión enviada al sistema de escritorio.');
    } catch (e: any) {
      alert('Error al imprimir: ' + e.message);
    }
  };

  // Rotate operations
  const handleRotateLeft = () => {
    if (editor.pageOrder.length === 0) return;
    const currentOrigIdx = editor.pageOrder[editor.selectedPage];
    editor.rotatePage(currentOrigIdx, 'left');
  };

  const handleRotateRight = () => {
    if (editor.pageOrder.length === 0) return;
    const currentOrigIdx = editor.pageOrder[editor.selectedPage];
    editor.rotatePage(currentOrigIdx, 'right');
  };

  // Delete page operation
  const handleDeletePage = () => {
    if (editor.pageOrder.length === 0) return;
    const currentOrigIdx = editor.pageOrder[editor.selectedPage];
    editor.deletePage(currentOrigIdx);
  };

  // Handle Load Merged PDF
  const handleLoadMergedPdf = (file: { name: string; path: string; data: Uint8Array }, docProxy: any) => {
    editor.loadPdf(file, docProxy);
  };

  // Insert Image
  const handleInsertImage = async () => {
    if (!window.electronAPI) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e: any) => {
        const file = e.target.files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event: any) => {
            const dataUrl = event.target.result;
            const currentOrigIdx = editor.pageOrder[editor.selectedPage];
            editor.addAnnotation(currentOrigIdx, {
              id: generateUUID(),
              type: 'image',
              x: 50,
              y: 50,
              w: 200,
              h: 200,
              imageBase64: dataUrl
            });
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
      return;
    }

    try {
      const result = await window.electronAPI.openImage();
      if (!result) return;
      const bytes = safeToUint8Array(result.data);
      const base64 = btoa(String.fromCharCode(...bytes));
      const dataUrl = `data:image/${result.name.endsWith('.png') ? 'png' : 'jpeg'};base64,${base64}`;
      
      const currentOrigIdx = editor.pageOrder[editor.selectedPage];
      editor.addAnnotation(currentOrigIdx, {
        id: generateUUID(),
        type: 'image',
        x: 50,
        y: 50,
        w: 200,
        h: 200,
        imageBase64: dataUrl
      });
    } catch (e: any) {
      alert('Error al insertar imagen: ' + e.message);
    }
  };

  // Insert Blank Page
  const handleInsertBlankPage = async () => {
    try {
      const blankPdfBytes = await PDFDocument.create();
      const blankPage = blankPdfBytes.addPage([612, 792]);
      const font = await blankPdfBytes.embedFont('Helvetica');
      blankPage.drawText('Página en blanco', {
        x: 50, y: 750, size: 12, font, color: rgb(0.5, 0.5, 0.5)
      });
      const pdfBytes = await blankPdfBytes.save();
      
      await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
      
      const currentOrigIdx = editor.pageOrder[editor.selectedPage];
      editor.insertBlankPage(currentOrigIdx, pdfBytes);
    } catch (e: any) {
      alert('Error al insertar página: ' + e.message);
    }
  };

  // Selected annotation ID state
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);

  // Retrieve the active selected annotation
  const currentOrigIdx = editor.pageOrder[editor.selectedPage];
  const pageAnnotations = editor.annotations[currentOrigIdx] || [];
  const selectedAnn = pageAnnotations.find(ann => ann.id === selectedAnnId);

  // Reset selected annotation on page change or document close
  useEffect(() => {
    setSelectedAnnId(null);
  }, [editor.selectedPage, editor.pdfFile]);

  // Duplication callback
  const handleDuplicateAnnotation = useCallback((annId: string) => {
    const pageAnns = editor.annotations[currentOrigIdx] || [];
    const targetAnn = pageAnns.find(ann => ann.id === annId);
    if (!targetAnn) return;

    const duplicate = JSON.parse(JSON.stringify(targetAnn));
    duplicate.id = generateUUID();
    
    if ('x' in duplicate && 'y' in duplicate) {
      duplicate.x = (duplicate.x || 0) + 15;
      duplicate.y = (duplicate.y || 0) + 15;
    } else if (duplicate.type === 'drawing' && duplicate.points) {
      duplicate.points = duplicate.points.map((p: any) => ({ x: p.x + 15, y: p.y + 15 }));
    }

    editor.addAnnotation(currentOrigIdx, duplicate);
    setSelectedAnnId(duplicate.id);
  }, [editor.annotations, currentOrigIdx, editor.addAnnotation]);

  // Layer change callback
  const handleLayerChange = useCallback((annId: string, action: 'front' | 'back') => {
    const pageAnns = editor.annotations[currentOrigIdx] || [];
    const targetAnn = pageAnns.find(ann => ann.id === annId);
    if (!targetAnn) return;

    const filtered = pageAnns.filter(ann => ann.id !== annId);
    let updatedList: any[];
    if (action === 'front') {
      updatedList = [...filtered, targetAnn];
    } else {
      updatedList = [targetAnn, ...filtered];
    }

    editor.reorderAnnotations(currentOrigIdx, updatedList);
  }, [editor.annotations, currentOrigIdx, editor.reorderAnnotations]);

  // Deletion callback
  const handleDeleteAnnotation = useCallback((annId: string) => {
    editor.removeAnnotation(currentOrigIdx, annId);
    setSelectedAnnId(null);
  }, [currentOrigIdx, editor.removeAnnotation]);

  // Update callback
  const handleUpdateAnnotation = useCallback((annId: string, fields: any) => {
    editor.updateAnnotation(currentOrigIdx, annId, fields);
  }, [currentOrigIdx, editor.updateAnnotation]);

  return (
    <div className={`flex flex-col h-screen overflow-hidden select-none ${darkMode ? 'dark bg-slate-900' : 'bg-slate-100'}`}>
      
      {/* 1. Ribbon Bar */}
      <Ribbon 
        activeTab={editor.activeTab}
        setActiveTab={editor.setActiveTab}
        activeTool={editor.activeTool}
        setActiveTool={editor.setActiveTool}
        drawColor={editor.drawColor}
        setDrawColor={editor.setDrawColor}
        drawWidth={editor.drawWidth}
        setDrawWidth={editor.setDrawWidth}
        fontSize={editor.fontSize}
        setFontSize={editor.setFontSize}
        hasUndo={editor.hasUndo}
        hasRedo={editor.hasRedo}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onOpen={handleOpenPdf}
        onSave={handleSavePdf}
        onSaveAs={handleSaveAsPdf}
        onPrint={handlePrintPdf}
        onClose={editor.closePdf}
        onRotateLeft={handleRotateLeft}
        onRotateRight={handleRotateRight}
        onDeletePage={handleDeletePage}
        onOpenMerge={() => setIsMergeOpen(true)}
        onOpenSecurity={() => setIsSecurityOpen(true)}
        onOpenWatermark={() => setIsWatermarkOpen(true)}
        onOpenOCR={() => setIsOCROpen(true)}
        hasFile={!!editor.pdfFile}
        darkMode={darkMode}
        onToggleDarkMode={toggleDarkMode}
        onInsertImage={handleInsertImage}
        onInsertBlankPage={handleInsertBlankPage}
      />

      {/* 2. Main Workspace layout (Sidebar + PDF Render Canvas) */}
      <div className="flex-1 flex overflow-hidden min-h-0 w-full relative">
        <Sidebar 
          pdfFile={editor.pdfFile}
          pdfDoc={editor.pdfDoc}
          pageOrder={editor.pageOrder}
          pageMods={editor.pageMods}
          selectedPage={editor.selectedPage}
          setSelectedPage={editor.setSelectedPage}
          onRotatePage={editor.rotatePage}
          onDeletePage={editor.deletePage}
          onReorderPages={editor.reorderPages}
          savedSignatures={editor.savedSignatures}
          addSavedSignature={editor.addSavedSignature}
          deleteSavedSignature={editor.deleteSavedSignature}
          setActiveTool={editor.setActiveTool}
          activeTool={editor.activeTool}
          onSelectSignature={setSelectedSignature}
          darkMode={darkMode}
          
          bookmarks={editor.bookmarks}
          addBookmark={editor.addBookmark}
          removeBookmark={editor.removeBookmark}
          
          isEditingAll={editor.isEditingAll}
          setIsEditingAll={editor.setIsEditingAll}

          selectedAnnId={selectedAnnId}
          setSelectedAnnId={setSelectedAnnId}
          selectedAnn={selectedAnn}
          onUpdateAnnotation={handleUpdateAnnotation}
          onDuplicateAnnotation={handleDuplicateAnnotation}
          onLayerChange={handleLayerChange}
          onDeleteAnnotation={handleDeleteAnnotation}
        />

        <Workspace 
          pdfFile={editor.pdfFile}
          pdfDoc={editor.pdfDoc}
          pageOrder={editor.pageOrder}
          pageMods={editor.pageMods}
          annotations={editor.annotations}
          selectedPage={editor.selectedPage}
          zoom={editor.zoom}
          activeTool={editor.activeTool}
          drawColor={editor.drawColor}
          drawWidth={editor.drawWidth}
          fontSize={editor.fontSize}
          addAnnotation={editor.addAnnotation}
          removeAnnotation={editor.removeAnnotation}
          updateAnnotation={editor.updateAnnotation}
          reorderAnnotations={editor.reorderAnnotations}
          selectedSignature={selectedSignature}
          setActiveTool={editor.setActiveTool}
          replaceDocumentText={editor.replaceDocumentText}
          replaceMultipleDocumentTexts={editor.replaceMultipleDocumentTexts}
          setZoom={editor.setZoom}
          
          isEditingAll={editor.isEditingAll}
          convertedPages={editor.convertedPages}
          setConvertedPages={editor.setConvertedPages}
          activeTab={editor.activeTab}

          selectedAnnId={selectedAnnId}
          setSelectedAnnId={setSelectedAnnId}
        />
      </div>

      {/* 3. Status Bar */}
      <StatusBar 
        selectedPage={editor.selectedPage}
        pageCount={editor.pageOrder.length}
        setSelectedPage={editor.setSelectedPage}
        zoom={editor.zoom}
        setZoom={editor.setZoom}
        hasFile={!!editor.pdfFile}
        darkMode={darkMode}
      />

      {/* 4. Overlay Popups */}
      <MergeModal 
        isOpen={isMergeOpen} 
        onClose={() => setIsMergeOpen(false)}
        onLoadMergedPdf={handleLoadMergedPdf}
        darkMode={darkMode}
        currentFile={editor.pdfFile ? { name: editor.pdfFile.name, path: editor.pdfFile.path } : null}
        onGetCurrentBytes={editor.compileAndSave}
      />

      <SecurityModal 
        isOpen={isSecurityOpen} 
        onClose={() => setIsSecurityOpen(false)}
        security={editor.security}
        setSecurity={editor.setSecurity}
        darkMode={darkMode}
      />

      <WatermarkModal 
        isOpen={isWatermarkOpen} 
        onClose={() => setIsWatermarkOpen(false)}
        watermark={editor.watermark}
        setWatermark={editor.setWatermark}
        darkMode={darkMode}
      />

      <OCRModal 
        isOpen={isOCROpen} 
        onClose={() => setIsOCROpen(false)}
        darkMode={darkMode}
      />

      <AlertModal 
        isOpen={alertMessage !== null}
        message={alertMessage || ''}
        onClose={() => setAlertMessage(null)}
        darkMode={darkMode}
      />

    </div>
  );
}
