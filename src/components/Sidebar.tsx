import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, Bookmark, FileSignature, Search, Trash2, RotateCw, 
  ArrowUp, ArrowDown, ChevronRight, Type, CheckCircle,
  AlignLeft, AlignCenter, AlignRight, ChevronUp, ChevronDown, Copy
} from 'lucide-react';
import type { ActiveTool } from '../hooks/usePDFEditor';
import type { PageModification } from '../utils/pdfCompiler';

// Component to render a single PDF page thumbnail lazily using IntersectionObserver
interface ThumbnailProps {
  pdfDoc: any;
  pageIndex: number;
  rotation: number;
}

const Thumbnail: React.FC<ThumbnailProps> = ({ pdfDoc, pageIndex, rotation }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isRendered, setIsRendered] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(canvas);
        }
      });
    }, { rootMargin: '100px' });

    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isVisible || !pdfDoc || isRendered) return;

    let active = true;
    const render = async () => {
      try {
        const page = await pdfDoc.getPage(pageIndex + 1);
        const scale = 0.2;
        const viewport = page.getViewport({ scale, rotation });
        
        const canvas = canvasRef.current;
        if (!canvas || !active) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        setIsRendered(true);
      } catch (err) {
        // Silently fail for thumbnails
      }
    };

    render();

    return () => {
      active = false;
    };
  }, [isVisible, pdfDoc, pageIndex, rotation, isRendered]);

  useEffect(() => {
    setIsRendered(false);
  }, [rotation]);

  return (
    <canvas 
      ref={canvasRef}
      className="w-full h-full object-contain"
    />
  );
};



interface SidebarProps {
  pdfFile: { name: string; path: string; data: Uint8Array } | null;
  pdfDoc: any;
  pageOrder: number[];
  pageMods: Record<number, PageModification>;
  selectedPage: number;
  setSelectedPage: (page: number) => void;
  onRotatePage: (origIdx: number, dir: 'left' | 'right') => void;
  onDeletePage: (origIdx: number) => void;
  onReorderPages: (newOrder: number[]) => void;
  savedSignatures: string[];
  addSavedSignature: (base64: string) => void;
  deleteSavedSignature: (index: number) => void;
  setActiveTool: (tool: ActiveTool) => void;
  activeTool: ActiveTool;
  onSelectSignature: (base64: string) => void;
  darkMode: boolean;
  
  bookmarks: Array<{ title: string; pageIndex: number }>;
  addBookmark: (title: string, pageIndex: number) => void;
  removeBookmark: (index: number) => void;

  isEditingAll: boolean;
  setIsEditingAll: (val: boolean) => void;

  selectedAnnId: string | null;
  setSelectedAnnId: (id: string | null) => void;
  selectedAnn?: any;
  onUpdateAnnotation?: (annId: string, fields: any) => void;
  onDuplicateAnnotation?: (annId: string) => void;
  onLayerChange?: (annId: string, action: 'front' | 'back') => void;
  onDeleteAnnotation?: (annId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  pdfFile,
  pdfDoc,
  pageOrder,
  pageMods,
  selectedPage,
  setSelectedPage,
  onRotatePage,
  onDeletePage,
  onReorderPages,
  savedSignatures,
  addSavedSignature,
  deleteSavedSignature,
  setActiveTool,
  activeTool,
  onSelectSignature,
  darkMode,
  
  bookmarks,
  addBookmark,
  removeBookmark,
  
  isEditingAll,
  setIsEditingAll,

  setSelectedAnnId,
  selectedAnn,
  onUpdateAnnotation,
  onDuplicateAnnotation,
  onLayerChange,
  onDeleteAnnotation
}) => {
  const [activeSidebarTab, setActiveSidebarTab] = useState<'pages' | 'bookmarks' | 'signatures' | 'search' | 'edit'>('pages');
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ pageIndex: number; text: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Bookmarks addition state
  const [newBookmarkTitle, setNewBookmarkTitle] = useState('');

  // Signature drawing state
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawingSig, setIsDrawingSig] = useState(false);
  const [selectedSigIdx, setSelectedSigIdx] = useState<number | null>(null);

  // Reset search results when document changes
  useEffect(() => {
    if (!pdfDoc) {
      setSearchResults([]);
    }
  }, [pdfDoc]);

  // Signature pad auto-resize and window resize listeners
  useEffect(() => {
    const resizeCanvas = () => {
      if (activeSidebarTab === 'signatures' && sigCanvasRef.current) {
        const canvas = sigCanvasRef.current;
        const container = canvas.parentElement;
        if (container) {
          const availableWidth = container.clientWidth - 24; 
          canvas.width = availableWidth;
          canvas.style.width = `${availableWidth}px`;
        }
      }
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [activeSidebarTab]);

  const handleAddBookmarkClick = () => {
    if (newBookmarkTitle.trim() === '') return;
    addBookmark(newBookmarkTitle, selectedPage);
    setNewBookmarkTitle('');
  };

  // Handle reordering pages
  const movePage = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === pageOrder.length - 1) return;

    const newOrder = [...pageOrder];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;

    onReorderPages(newOrder);
    
    // Maintain selection on the moved page
    if (selectedPage === index) {
      setSelectedPage(targetIndex);
    } else if (selectedPage === targetIndex) {
      setSelectedPage(index);
    }
  };

  // Perform PDF Search
  const handleSearch = async () => {
    if (!pdfDoc || searchQuery.trim() === '') return;
    setIsSearching(true);
    const results: { pageIndex: number; text: string }[] = [];

    try {
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const textStr = textContent.items.map((item: any) => item.str).join(' ');
        
        if (textStr.toLowerCase().includes(searchQuery.toLowerCase())) {
          // Grab a snippet around the match
          const index = textStr.toLowerCase().indexOf(searchQuery.toLowerCase());
          const start = Math.max(0, index - 20);
          const end = Math.min(textStr.length, index + searchQuery.length + 30);
          const snippet = '...' + textStr.substring(start, end).trim() + '...';
          
          results.push({
            pageIndex: i - 1, // 0-indexed for state
            text: snippet
          });
        }
      }
      setSearchResults(results);
    } catch (e) {
      console.error('Error during search:', e);
    } finally {
      setIsSearching(false);
    }
  };

  // Signature pad drawing functions
  const startSigDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000000';
    setIsDrawingSig(true);
  };

  const drawSig = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingSig) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopSigDrawing = () => {
    setIsDrawingSig(false);
  };

  const clearSigPad = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const saveSignature = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    
    // Check if canvas is empty (quick validation)
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const base64 = canvas.toDataURL('image/png');
    addSavedSignature(base64);
    clearSigPad();
  };

  return (
    <div className={`w-80 flex h-full select-none z-10 shrink-0 ${
      darkMode ? 'bg-slate-800 border-r border-slate-700' : 'bg-slate-50 border-r border-slate-200'
    }`}>
      
      {/* Vertical tab buttons bar */}
      <div className={`w-12 flex flex-col items-center py-4 space-y-6 ${
        darkMode ? 'bg-slate-900 border-r border-slate-700' : 'bg-slate-100 border-r border-slate-200'
      }`}>
        <button 
          onClick={() => setActiveSidebarTab('pages')} 
          className={`p-2 rounded-lg transition-colors ${activeSidebarTab === 'pages' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}
          title="Páginas"
        >
          <FileText size={20} />
        </button>
        <button 
          onClick={() => {
            setActiveSidebarTab('edit');
            setIsEditingAll(true);
            setActiveTool('select');
          }} 
          className={`p-2 rounded-lg transition-colors ${activeSidebarTab === 'edit' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}
          title="Editar Texto"
        >
          <Type size={20} />
        </button>
        <button 
          onClick={() => setActiveSidebarTab('signatures')} 
          className={`p-2 rounded-lg transition-colors ${activeSidebarTab === 'signatures' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}
          title="Firmas"
        >
          <FileSignature size={20} />
        </button>
        <button 
          onClick={() => setActiveSidebarTab('bookmarks')} 
          className={`p-2 rounded-lg transition-colors ${activeSidebarTab === 'bookmarks' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}
          title="Marcadores"
        >
          <Bookmark size={20} />
        </button>
        <button 
          onClick={() => setActiveSidebarTab('search')} 
          className={`p-2 rounded-lg transition-colors ${activeSidebarTab === 'search' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}
          title="Buscar"
        >
          <Search size={20} />
        </button>
      </div>

      {/* Main Tab Panel Content */}
      <div className={`flex-1 flex flex-col min-w-0 h-full overflow-hidden ${
        darkMode ? 'bg-slate-800' : 'bg-white'
      }`}>
        <div className={`p-3 flex items-center justify-between ${
          darkMode ? 'bg-slate-900 border-b border-slate-700' : 'bg-slate-50 border-b border-slate-200'
        }`}>
          <span className={`font-semibold text-xs tracking-wider uppercase ${
            darkMode ? 'text-slate-300' : 'text-slate-700'
          }`}>
            {activeSidebarTab === 'pages' && 'Organizar Páginas'}
            {activeSidebarTab === 'edit' && 'Editar Texto'}
            {activeSidebarTab === 'signatures' && 'Panel de Firmas'}
            {activeSidebarTab === 'bookmarks' && 'Marcadores / Esquema'}
            {activeSidebarTab === 'search' && 'Buscar en Documento'}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          
          {/* TAB: PAGES / THUMBNAILS */}
          {activeSidebarTab === 'pages' && (
            <div className="space-y-4">
              {!pdfFile ? (
                <div className="text-center text-slate-400 py-8 text-xs">
                  Carga un PDF para ver sus páginas.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {pageOrder.map((origIdx, index) => (
                    <div 
                      key={`${origIdx}-${index}`}
                      onClick={() => setSelectedPage(index)}
                      className={`p-2 rounded-lg border transition-all cursor-pointer flex items-center space-x-3 ${
                        selectedPage === index 
                          ? 'border-brand-500 bg-brand-50/40 ring-1 ring-brand-400 dark:bg-brand-900/20' 
                          : darkMode ? 'border-slate-700 hover:bg-slate-700/50' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {/* Page Thumbnail Preview */}
                      <div className={`flex flex-col items-center justify-center w-14 h-16 rounded text-xs font-bold overflow-hidden border shrink-0 ${
                        darkMode ? 'bg-slate-700 border-slate-600 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-600'
                      }`}>
                        <Thumbnail 
                          pdfDoc={pdfDoc}
                          pageIndex={origIdx}
                          rotation={pageMods[origIdx]?.rotation || 0}
                        />
                      </div>

                      {/* Mini Thumbnail placeholder and details */}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">Pág. {origIdx + 1}</div>
                        <div className="text-[10px] text-slate-400 flex items-center space-x-1.5 mt-0.5">
                          {pageMods[origIdx]?.rotation ? <RotateCw size={10} className="text-amber-500" /> : null}
                          {pageMods[origIdx]?.rotation ? <span>{pageMods[origIdx].rotation}°</span> : null}
                        </div>
                      </div>

                      {/* Page controls */}
                      <div className="flex items-center space-x-1" onClick={e => e.stopPropagation()}>
                        <button 
                          onClick={() => movePage(index, 'up')}
                          disabled={index === 0}
                          className="p-1 hover:bg-slate-200 rounded disabled:opacity-30 disabled:hover:bg-transparent text-slate-500"
                          title="Subir página"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button 
                          onClick={() => movePage(index, 'down')}
                          disabled={index === pageOrder.length - 1}
                          className="p-1 hover:bg-slate-200 rounded disabled:opacity-30 disabled:hover:bg-transparent text-slate-500"
                          title="Bajar página"
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button 
                          onClick={() => onRotatePage(origIdx, 'right')}
                          className="p-1 hover:bg-slate-200 rounded text-slate-500"
                          title="Rotar 90°"
                        >
                          <RotateCw size={12} />
                        </button>
                        <button 
                          onClick={() => onDeletePage(origIdx)}
                          className="p-1 hover:bg-red-50 text-red-600 rounded"
                          title="Eliminar página"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB: EDIT TEXT */}
          {activeSidebarTab === 'edit' && (
            <div className="space-y-4 animate-fade-in">
              {!pdfFile ? (
                <div className="text-center text-slate-400 py-8 text-xs">
                  Carga un PDF para editar su texto.
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Selected Object properties */}
                  {selectedAnn ? (
                    <div className="space-y-4 animate-fade-in bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700/55 rounded-lg p-3">
                      {/* Element Type header */}
                      <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700/50">
                        <span className="text-[11px] font-bold text-slate-550 dark:text-slate-400 uppercase tracking-wider">
                          Propiedades de {selectedAnn.type === 'text' ? 'Texto' : selectedAnn.type === 'image' ? 'Imagen' : selectedAnn.type === 'signature' ? 'Firma' : 'Elemento'}
                        </span>
                        <button 
                          onClick={() => setSelectedAnnId(null)}
                          className="text-[10px] text-brand-600 dark:text-brand-400 hover:underline transition-all font-semibold"
                        >
                          Deseleccionar
                        </button>
                      </div>

                      {/* TEXT SPECIFIC CONTROLS */}
                      {selectedAnn.type === 'text' && (
                        <div className="space-y-3.5">
                          {/* Font Family Selection */}
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Fuente</label>
                            <select
                              value={selectedAnn.fontFamily || 'Helvetica'}
                              onChange={(e) => onUpdateAnnotation?.(selectedAnn.id, { fontFamily: e.target.value })}
                              className="w-full bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-205 dark:border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
                            >
                              <option value="Helvetica">Helvetica</option>
                              <option value="Times">Times Roman</option>
                              <option value="Courier">Courier</option>
                              <option value="Roboto">Roboto</option>
                              <option value="Montserrat">Montserrat</option>
                              <option value="Open Sans">Open Sans</option>
                              <option value="Lato">Lato</option>
                              <option value="Oswald">Oswald</option>
                              <option value="Source Sans Pro">Source Sans Pro</option>
                              <option value="Lora">Lora</option>
                              <option value="Merriweather">Merriweather</option>
                              <option value="Nunito">Nunito</option>
                              <option value="Raleway">Raleway</option>
                              <option value="Inter">Inter</option>
                              <option value="Outfit">Outfit</option>
                              <option value="Poppins">Poppins</option>
                              <option value="Playfair Display">Playfair Display</option>
                              <option value="Pacifico">Pacifico</option>
                              <option value="Lobster">Lobster</option>
                            </select>
                          </div>

                          {/* Font Size controls */}
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Tamaño</label>
                            <div className="flex items-center space-x-1.5">
                              <input
                                type="number"
                                value={selectedAnn.fontSize || 14}
                                min="6"
                                max="144"
                                onChange={(e) => onUpdateAnnotation?.(selectedAnn.id, { fontSize: Math.max(6, Math.min(144, Number(e.target.value) || 14)) })}
                                className="w-16 bg-white dark:bg-slate-800 border border-slate-205 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-center text-xs py-1 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <select
                                value={selectedAnn.fontSize || 14}
                                onChange={(e) => onUpdateAnnotation?.(selectedAnn.id, { fontSize: Number(e.target.value) })}
                                className="flex-1 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-205 dark:border-slate-700 rounded px-1.5 py-1 text-xs focus:outline-none cursor-pointer"
                              >
                                {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72].map(size => (
                                  <option key={size} value={size}>{size} px</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Format Styles (B, I, U) & Alignment */}
                          <div className="grid grid-cols-2 gap-2">
                            {/* Text style group */}
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Estilo</label>
                              <div className="flex bg-white dark:bg-slate-800 border border-slate-205 dark:border-slate-700 rounded p-0.5">
                                <button
                                  onClick={() => onUpdateAnnotation?.(selectedAnn.id, { bold: !selectedAnn.bold })}
                                  className={`flex-1 py-0.5 rounded text-[11px] font-bold transition-all ${
                                    selectedAnn.bold ? 'bg-brand-600 text-white shadow-sm' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                                  }`}
                                  title="Negrita"
                                >
                                  B
                                </button>
                                <button
                                  onClick={() => onUpdateAnnotation?.(selectedAnn.id, { italic: !selectedAnn.italic })}
                                  className={`flex-1 py-0.5 rounded text-[11px] italic transition-all ${
                                    selectedAnn.italic ? 'bg-brand-600 text-white shadow-sm' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                                  }`}
                                  title="Cursiva"
                                >
                                  I
                                </button>
                                <button
                                  onClick={() => onUpdateAnnotation?.(selectedAnn.id, { underline: !selectedAnn.underline })}
                                  className={`flex-1 py-0.5 rounded text-[11px] underline transition-all ${
                                    selectedAnn.underline ? 'bg-brand-600 text-white shadow-sm' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                                  }`}
                                  title="Subrayado"
                                >
                                  U
                                </button>
                              </div>
                            </div>

                            {/* Alignment Group */}
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Alineación</label>
                              <div className="flex bg-white dark:bg-slate-800 border border-slate-205 dark:border-slate-700 rounded p-0.5">
                                <button
                                  onClick={() => onUpdateAnnotation?.(selectedAnn.id, { align: 'left' })}
                                  className={`flex-1 py-0.5 rounded transition-all flex justify-center items-center ${
                                    (selectedAnn.align || 'left') === 'left' ? 'bg-brand-600 text-white shadow-sm' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                                  }`}
                                >
                                  <AlignLeft size={12} />
                                </button>
                                <button
                                  onClick={() => onUpdateAnnotation?.(selectedAnn.id, { align: 'center' })}
                                  className={`flex-1 py-0.5 rounded transition-all flex justify-center items-center ${
                                    (selectedAnn.align || 'left') === 'center' ? 'bg-brand-600 text-white shadow-sm' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                                  }`}
                                >
                                  <AlignCenter size={12} />
                                </button>
                                <button
                                  onClick={() => onUpdateAnnotation?.(selectedAnn.id, { align: 'right' })}
                                  className={`flex-1 py-0.5 rounded transition-all flex justify-center items-center ${
                                    (selectedAnn.align || 'left') === 'right' ? 'bg-brand-600 text-white shadow-sm' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300'
                                  }`}
                                >
                                  <AlignRight size={12} />
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Color Picker */}
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Color de Texto</label>
                            <div className="flex items-center space-x-2.5 bg-white dark:bg-slate-800 border border-slate-205 dark:border-slate-700 rounded p-2">
                              <div className="relative w-7 h-7 rounded-full overflow-hidden border border-slate-300 dark:border-slate-600 cursor-pointer shadow-sm flex-shrink-0">
                                <input
                                  type="color"
                                  value={selectedAnn.color || '#000000'}
                                  onChange={(e) => onUpdateAnnotation?.(selectedAnn.id, { color: e.target.value })}
                                  className="absolute -inset-2 w-12 h-12 cursor-pointer p-0 bg-transparent border-0"
                                />
                              </div>
                              <div>
                                <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300 uppercase">{selectedAnn.color || '#000000'}</span>
                                <span className="text-[9px] text-slate-400 block">Haz clic para cambiar color</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* IMAGE/SIGNATURE SPECIFIC CONTROLS */}
                      {(selectedAnn.type === 'image' || selectedAnn.type === 'signature') && (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Opacidad</label>
                            <div className="bg-white dark:bg-slate-800 border border-slate-205 dark:border-slate-700 rounded p-2.5 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-slate-400">Nivel</span>
                                <span className="text-[11px] font-mono font-bold text-brand-600 dark:text-brand-400">
                                  {Math.round((selectedAnn.opacity !== undefined ? selectedAnn.opacity : 1) * 100)}%
                                </span>
                              </div>
                              <input
                                type="range"
                                min="10"
                                max="100"
                                step="5"
                                value={Math.round((selectedAnn.opacity !== undefined ? selectedAnn.opacity : 1) * 100)}
                                onChange={(e) => onUpdateAnnotation?.(selectedAnn.id, { opacity: Number(e.target.value) / 100 })}
                                className="w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-brand-500"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ORGANIZE / LAYER CONTROLS */}
                      <div className="space-y-1 pt-1 border-t border-slate-200 dark:border-slate-700/55">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Orden de Capas</label>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            onClick={() => onLayerChange?.(selectedAnn.id, 'front')}
                            className="py-1 px-2 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-350 border border-slate-200 dark:border-slate-700 rounded text-xs font-semibold transition-colors flex items-center justify-center space-x-1 cursor-pointer"
                          >
                            <ChevronUp size={12} className="text-brand-600" />
                            <span>Al Frente</span>
                          </button>
                          <button
                            onClick={() => onLayerChange?.(selectedAnn.id, 'back')}
                            className="py-1 px-2 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-350 border border-slate-200 dark:border-slate-700 rounded text-xs font-semibold transition-colors flex items-center justify-center space-x-1 cursor-pointer"
                          >
                            <ChevronDown size={12} className="text-brand-600" />
                            <span>Al Fondo</span>
                          </button>
                        </div>
                      </div>

                      {/* EDIT ACTIONS */}
                      <div className="space-y-1 pt-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Acciones</label>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            onClick={() => onDuplicateAnnotation?.(selectedAnn.id)}
                            className="py-1 px-2 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-350 border border-slate-200 dark:border-slate-700 rounded text-xs font-semibold transition-colors flex items-center justify-center space-x-1 cursor-pointer"
                          >
                            <Copy size={11} className="text-emerald-500" />
                            <span>Duplicar</span>
                          </button>
                          <button
                            onClick={() => onDeleteAnnotation?.(selectedAnn.id)}
                            className="py-1 px-2 bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/45 text-red-750 dark:text-red-400 border border-red-200 dark:border-red-900/50 rounded text-xs font-semibold transition-colors flex items-center justify-center space-x-1 cursor-pointer"
                          >
                            <Trash2 size={11} className="text-red-500" />
                            <span>Eliminar</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Default state when nothing is selected */
                    <div className="p-3 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700/55 rounded-lg space-y-3">
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block uppercase">Edición de Texto</span>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        Habilita el modo de edición para modificar cualquier bloque de texto original del documento.
                      </p>
                      
                      {!isEditingAll ? (
                        <button
                          onClick={() => {
                            setIsEditingAll(true);
                            setActiveTool('select');
                          }}
                          className="w-full py-2 px-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm flex items-center justify-center space-x-2 cursor-pointer"
                        >
                          <Type size={14} />
                          <span>Editar Todo el Texto</span>
                        </button>
                      ) : (
                        <div className="space-y-2.5">
                          <div className="p-2.5 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40 rounded-lg text-green-800 dark:text-green-300 text-[11px] flex items-start space-x-2">
                            <CheckCircle size={14} className="shrink-0 mt-0.5" />
                            <span>Modo edición activo. Haz doble clic en cualquier texto del PDF para editarlo directamente.</span>
                          </div>
                          <button
                            onClick={() => {
                              setIsEditingAll(false);
                            }}
                            className="w-full py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center space-x-2 cursor-pointer"
                          >
                            <span>Finalizar Edición</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB: SIGNATURES */}
          {activeSidebarTab === 'signatures' && (
            <div className="space-y-4">
              {/* Signature Creator Canvas */}
              <div className="border border-slate-200 rounded-lg p-2.5 bg-slate-50">
                <span className="text-[11px] font-semibold text-slate-500 block mb-1.5 uppercase">Crear Nueva Firma</span>
                <canvas 
                  ref={sigCanvasRef}
                  width={260}
                  height={110}
                  onMouseDown={startSigDrawing}
                  onMouseMove={drawSig}
                  onMouseUp={stopSigDrawing}
                  onMouseLeave={stopSigDrawing}
                  className="bg-white border border-slate-300 rounded cursor-crosshair shadow-inner"
                />
                <div className="flex items-center justify-end space-x-2 mt-2">
                  <button 
                    onClick={clearSigPad} 
                    className="px-2 py-1 text-[10px] font-medium border border-slate-300 rounded hover:bg-slate-100 text-slate-600 transition-colors"
                  >
                    Limpiar
                  </button>
                  <button 
                    onClick={saveSignature} 
                    className="px-2.5 py-1 text-[10px] font-medium bg-brand-600 text-white rounded hover:bg-brand-700 shadow-sm transition-colors"
                  >
                    Guardar
                  </button>
                </div>
              </div>

              {/* Saved Signatures List */}
              <div className="space-y-2.5">
                <span className="text-[11px] font-semibold text-slate-500 block uppercase">Firmas Guardadas</span>
                {savedSignatures.length === 0 ? (
                  <div className="text-center text-slate-400 py-6 text-xs italic">
                    No tienes firmas guardadas. Dibuja una arriba.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {savedSignatures.map((sigData, idx) => (
                      <div 
                        key={idx}
                        onClick={() => {
                          setSelectedSigIdx(idx);
                          setActiveTool('signature');
                          onSelectSignature(sigData);
                        }}
                        className={`p-2 border rounded-lg cursor-pointer flex items-center justify-between transition-all group relative ${
                          selectedSigIdx === idx && activeTool === 'signature'
                            ? 'border-brand-500 bg-brand-50/30' 
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <img 
                          src={sigData} 
                          alt={`Firma ${idx + 1}`} 
                          className="max-h-12 max-w-[160px] object-contain select-none pointer-events-none"
                        />
                        
                        <div className="flex items-center space-x-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {selectedSigIdx === idx && activeTool === 'signature' && (
                            <span className="text-[9px] bg-brand-100 text-brand-700 px-1 py-0.5 rounded font-bold uppercase">Listo</span>
                          )}
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSavedSignature(idx);
                              if (selectedSigIdx === idx) {
                                setSelectedSigIdx(null);
                                setActiveTool('hand');
                              }
                            }}
                            className="p-1 hover:bg-red-50 text-red-600 rounded"
                            title="Eliminar firma"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: BOOKMARKS */}
          {activeSidebarTab === 'bookmarks' && (
            <div className="space-y-4">
              {/* Add Bookmark form */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 bg-slate-50 dark:bg-slate-800/50">
                <span className="text-[11px] font-semibold text-slate-500 block mb-1.5 uppercase">Añadir Nuevo Marcador</span>
                <div className="flex space-x-1.5">
                  <input 
                    type="text" 
                    placeholder="Título del marcador..."
                    value={newBookmarkTitle}
                    onChange={(e) => setNewBookmarkTitle(e.target.value)}
                    className="flex-1 px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-brand-500"
                  />
                  <button 
                    onClick={handleAddBookmarkClick}
                    disabled={!pdfFile || newBookmarkTitle.trim() === ''}
                    className="px-2.5 py-1 bg-brand-600 hover:bg-brand-700 text-white text-xs rounded transition-colors disabled:opacity-40"
                  >
                    Añadir
                  </button>
                </div>
                <span className="text-[9px] text-slate-400 mt-1 block">Apunta a la página actual (Pág. {selectedPage + 1})</span>
              </div>

              {/* Bookmarks List */}
              <div className="space-y-2">
                <span className="text-[11px] font-semibold text-slate-500 block uppercase">Marcadores del Documento</span>
                {bookmarks.length === 0 ? (
                  <div className="text-center text-slate-400 py-8 text-xs italic">
                    Este documento no contiene marcadores de navegación.
                  </div>
                ) : (
                  <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
                    {bookmarks.map((bookmark, idx) => (
                      <div 
                        key={idx}
                        className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50 p-1.5 rounded cursor-pointer group"
                        onClick={() => setSelectedPage(bookmark.pageIndex)}
                      >
                        <div className="flex items-center space-x-2 min-w-0">
                          <ChevronRight size={12} className="text-slate-400 shrink-0" />
                          <span className="truncate font-medium">{bookmark.title}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">(Pág. {bookmark.pageIndex + 1})</span>
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            removeBookmark(idx);
                          }}
                          className="p-0.5 hover:bg-red-50 text-red-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Eliminar marcador"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: SEARCH */}
          {activeSidebarTab === 'search' && (
            <div className="space-y-3">
              <div className="flex space-x-1.5">
                <input 
                  type="text" 
                  placeholder="Palabra a buscar..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="flex-1 px-2.5 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:border-brand-500 bg-white text-slate-800"
                />
                <button 
                  onClick={handleSearch}
                  disabled={isSearching || searchQuery.trim() === ''}
                  className="px-3 py-1 bg-brand-600 hover:bg-brand-700 text-white text-xs rounded transition-colors disabled:opacity-40"
                >
                  Buscar
                </button>
              </div>

              {isSearching && (
                <div className="text-center text-xs text-slate-500 py-4">
                  Buscando coincidencia en el texto...
                </div>
              )}

              {!isSearching && searchResults.length === 0 && searchQuery !== '' && (
                <div className="text-center text-xs text-slate-400 py-4">
                  No se encontraron coincidencias.
                </div>
              )}

              {!isSearching && searchResults.length > 0 && (
                <div className="space-y-2.5 pt-2">
                  <span className="text-[10px] font-semibold text-slate-500 block uppercase">Resultados ({searchResults.length})</span>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {searchResults.map((res, idx) => (
                      <div 
                        key={idx}
                        onClick={() => setSelectedPage(res.pageIndex)}
                        className="p-2 border border-slate-100 hover:border-brand-300 rounded hover:bg-brand-50/10 cursor-pointer transition-all text-xs"
                      >
                        <div className="font-semibold text-brand-600 mb-0.5">Página {res.pageIndex + 1}</div>
                        <div className="text-slate-600 italic leading-snug line-clamp-2 select-text">{res.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
