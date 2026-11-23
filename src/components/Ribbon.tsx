import React from 'react';
import { 
  FolderOpen, Save, FileDown, Printer, Undo2, Redo2, Hand, MousePointer, 
  Type, Pencil, Square, Circle, Minus, FileSignature, Image, Tag, 
  RotateCw, RotateCcw, Trash2, Combine, Lock, Cpu, Info, FilePlus,
  Moon, Sun
} from 'lucide-react';
import type { ActiveTab, ActiveTool } from '../hooks/usePDFEditor';

interface RibbonProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  activeTool: ActiveTool;
  setActiveTool: (tool: ActiveTool) => void;
  drawColor: string;
  setDrawColor: (color: string) => void;
  drawWidth: number;
  setDrawWidth: (width: number) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  hasUndo: boolean;
  hasRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onPrint: () => void;
  onClose: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onDeletePage: () => void;
  onOpenMerge: () => void;
  onOpenSecurity: () => void;
  onOpenWatermark: () => void;
  onOpenOCR: () => void;
  hasFile: boolean;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onInsertImage: () => void;
  onInsertBlankPage: () => void;
}

export const Ribbon: React.FC<RibbonProps> = ({
  activeTab,
  setActiveTab,
  activeTool,
  setActiveTool,
  drawColor,
  setDrawColor,
  drawWidth,
  setDrawWidth,
  fontSize,
  setFontSize,
  hasUndo,
  hasRedo,
  onUndo,
  onRedo,
  onOpen,
  onSave,
  onSaveAs,
  onPrint,
  onClose,
  onRotateLeft,
  onRotateRight,
  onDeletePage,
  onOpenMerge,
  onOpenSecurity,
  onOpenWatermark,
  onOpenOCR,
  hasFile,
  darkMode,
  onToggleDarkMode,
  onInsertImage,
  onInsertBlankPage
}) => {
  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'archivo', label: 'Archivo' },
    { id: 'inicio', label: 'Inicio' },
    { id: 'editar', label: 'Editar' },
    { id: 'paginas', label: 'Páginas' },
    { id: 'comentarios', label: 'Comentarios' },
    { id: 'formularios', label: 'Formularios' },
    { id: 'proteger', label: 'Proteger' },
    { id: 'ayuda', label: 'Ayuda' }
  ];

  return (
    <div className={`border-b select-none flex flex-col z-30 shadow-sm ${
      darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'
    }`}>
      
      {/* Native-style Title Bar & Quick Access */}
      <div className="bg-slate-900 text-white px-4 py-2 flex items-center justify-between text-xs drag-region">
        <div className="flex items-center space-x-4 no-drag">
          <span className="font-bold tracking-wide text-brand-400">EDITOR PDF PRO</span>
          <div className="h-3 w-px bg-slate-700"></div>
          {/* Quick actions */}
          <button onClick={onOpen} className="hover:text-brand-300 transition-colors" title="Abrir Archivo">
            <FolderOpen size={14} />
          </button>
          <button 
            onClick={onSave} 
            disabled={!hasFile} 
            className="hover:text-brand-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors" 
            title="Guardar"
          >
            <Save size={14} />
          </button>
          <button 
            onClick={onUndo} 
            disabled={!hasUndo} 
            className="hover:text-brand-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors" 
            title="Deshacer"
          >
            <Undo2 size={14} />
          </button>
          <button 
            onClick={onRedo} 
            disabled={!hasRedo} 
            className="hover:text-brand-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors" 
            title="Rehacer"
          >
            <Redo2 size={14} />
          </button>
        </div>
        <div className="text-slate-300 font-medium flex items-center space-x-3">
          <span>{hasFile ? 'Editor PDF Pro - Documento Activo' : 'Editor PDF Pro'}</span>
          <div className="h-3 w-px bg-slate-700"></div>
          <button onClick={onToggleDarkMode} className="hover:text-brand-300 transition-colors" title={darkMode ? 'Modo Claro' : 'Modo Oscuro'}>
            {darkMode ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
        <div className="w-24"></div> {/* Spacer for symmetry */}
      </div>

      {/* Ribbon Tabs Headers */}
      <div className="flex bg-slate-100 border-b border-slate-200 px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-semibold relative transition-colors ${
              activeTab === tab.id 
                ? 'bg-white text-slate-900 border-x border-slate-200 ribbon-tab-active font-bold' 
                : 'text-slate-600 hover:text-slate-950 hover:bg-slate-200/50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Ribbon Actions Subpanel */}
      <div className="h-[76px] px-4 py-2 flex items-center space-x-6 overflow-x-auto no-scrollbar bg-white">
        
        {/* TAB: ARCHIVO */}
        {activeTab === 'archivo' && (
          <div className="flex items-center space-x-4 animate-fade-in">
            <div className="flex flex-col items-center">
              <button onClick={onOpen} className="p-1 hover:bg-slate-100 rounded flex flex-col items-center text-slate-700">
                <FolderOpen size={20} className="text-brand-600" />
                <span className="text-[10px] mt-1">Abrir</span>
              </button>
            </div>
            <div className="h-10 w-px bg-slate-200"></div>
            <div className="flex items-center space-x-3">
              <button onClick={onSave} disabled={!hasFile} className="p-1 hover:bg-slate-100 rounded flex flex-col items-center text-slate-700 disabled:opacity-40">
                <Save size={20} className="text-slate-700" />
                <span className="text-[10px] mt-1">Guardar</span>
              </button>
              <button onClick={onSaveAs} disabled={!hasFile} className="p-1 hover:bg-slate-100 rounded flex flex-col items-center text-slate-700 disabled:opacity-40">
                <FileDown size={20} className="text-slate-700" />
                <span className="text-[10px] mt-1">Guardar Como</span>
              </button>
              <button onClick={onPrint} disabled={!hasFile} className="p-1 hover:bg-slate-100 rounded flex flex-col items-center text-slate-700 disabled:opacity-40">
                <Printer size={20} className="text-slate-700" />
                <span className="text-[10px] mt-1">Imprimir</span>
              </button>
            </div>
            <div className="h-10 w-px bg-slate-200"></div>
            <button onClick={onClose} disabled={!hasFile} className="p-1 hover:bg-red-50 text-red-600 hover:text-red-700 rounded flex flex-col items-center disabled:opacity-40">
              <Trash2 size={20} />
              <span className="text-[10px] mt-1">Cerrar PDF</span>
            </button>
          </div>
        )}

        {/* TAB: INICIO */}
        {activeTab === 'inicio' && (
          <div className="flex items-center space-x-4 animate-fade-in">
            {/* Herramientas de navegación */}
            <div className="flex items-center space-x-1">
              <button 
                onClick={() => setActiveTool('hand')} 
                className={`p-2 rounded flex flex-col items-center w-12 ${activeTool === 'hand' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
                title="Mano para desplazarse"
              >
                <Hand size={18} />
                <span className="text-[9px] mt-0.5">Mano</span>
              </button>
              <button 
                onClick={() => setActiveTool('select')} 
                className={`p-2 rounded flex flex-col items-center w-12 ${activeTool === 'select' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
                title="Herramienta de selección"
              >
                <MousePointer size={18} />
                <span className="text-[9px] mt-0.5">Seleccionar</span>
              </button>
            </div>
            
            <div className="h-10 w-px bg-slate-200"></div>

            {/* Herramientas de edición básica */}
            <div className="flex items-center space-x-2">
              <button 
                disabled={!hasFile}
                onClick={() => setActiveTool('text')} 
                className={`p-2 rounded flex flex-col items-center w-14 disabled:opacity-40 ${activeTool === 'text' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
              >
                <Type size={18} />
                <span className="text-[9px] mt-0.5">Añadir Texto</span>
              </button>
              <button 
                disabled={!hasFile}
                onClick={() => setActiveTool('drawing')} 
                className={`p-2 rounded flex flex-col items-center w-12 disabled:opacity-40 ${activeTool === 'drawing' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
              >
                <Pencil size={18} />
                <span className="text-[9px] mt-0.5">Lápiz</span>
              </button>
              <button 
                disabled={!hasFile}
                onClick={() => setActiveTool('signature')} 
                className={`p-2 rounded flex flex-col items-center w-12 disabled:opacity-40 ${activeTool === 'signature' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
              >
                <FileSignature size={18} />
                <span className="text-[9px] mt-0.5">Firmar</span>
              </button>
            </div>

            <div className="h-10 w-px bg-slate-200"></div>

            {/* Combinar rápido */}
            <button 
              onClick={onOpenMerge}
              className="p-2 hover:bg-slate-100 rounded flex flex-col items-center text-slate-700"
            >
              <Combine size={18} className="text-emerald-600" />
              <span className="text-[9px] mt-0.5">Combinar</span>
            </button>
          </div>
        )}

        {/* TAB: EDITAR */}
        {activeTab === 'editar' && (
          <div className="flex items-center space-x-4 animate-fade-in">
            {/* Herramientas de navegación / selección */}
            <div className="flex items-center space-x-1">
              <button 
                onClick={() => setActiveTool('hand')} 
                className={`p-2 rounded flex flex-col items-center w-12 ${activeTool === 'hand' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
                title="Herramienta de mano (desplazarse)"
              >
                <Hand size={18} />
                <span className="text-[9px] mt-0.5">Mano</span>
              </button>
              <button 
                onClick={() => setActiveTool('select')} 
                className={`p-2 rounded flex flex-col items-center w-12 ${activeTool === 'select' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
                title="Herramienta de selección"
              >
                <MousePointer size={18} />
                <span className="text-[9px] mt-0.5">Seleccionar</span>
              </button>
            </div>
            
            <div className="h-10 w-px bg-slate-200"></div>

            <button 
              disabled={!hasFile}
              onClick={() => setActiveTool('text')}
              className={`p-2 rounded flex flex-col items-center w-14 disabled:opacity-40 ${activeTool === 'text' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
            >
              <Type size={18} />
              <span className="text-[9px] mt-0.5">Texto</span>
            </button>
            <button 
              disabled={!hasFile}
              onClick={onInsertImage}
              className="p-2 rounded flex flex-col items-center w-14 disabled:opacity-40 hover:bg-slate-100 text-slate-700"
              title="Insertar imagen en la página"
            >
              <Image size={18} />
              <span className="text-[9px] mt-0.5">Imagen</span>
            </button>
            <div className="h-10 w-px bg-slate-200"></div>
            
            <button 
              disabled={!hasFile}
              onClick={onOpenWatermark}
              className="p-2 hover:bg-slate-100 rounded flex flex-col items-center text-slate-700 disabled:opacity-40"
            >
              <Tag size={18} className="text-violet-600" />
              <span className="text-[9px] mt-0.5">Marca de Agua</span>
            </button>
          </div>
        )}

        {/* TAB: PÁGINAS */}
        {activeTab === 'paginas' && (
          <div className="flex items-center space-x-4 animate-fade-in">
            <div className="flex items-center space-x-1">
              <button 
                disabled={!hasFile}
                onClick={onRotateLeft} 
                className="p-2 hover:bg-slate-100 rounded flex flex-col items-center w-14 text-slate-700 disabled:opacity-40"
              >
                <RotateCcw size={18} />
                <span className="text-[9px] mt-0.5">Rotar Izq.</span>
              </button>
              <button 
                disabled={!hasFile}
                onClick={onRotateRight} 
                className="p-2 hover:bg-slate-100 rounded flex flex-col items-center w-14 text-slate-700 disabled:opacity-40"
              >
                <RotateCw size={18} />
                <span className="text-[9px] mt-0.5">Rotar Der.</span>
              </button>
            </div>
            
            <div className="h-10 w-px bg-slate-200"></div>
            
            <div className="flex items-center space-x-1">
              <button 
                disabled={!hasFile}
                onClick={onDeletePage} 
                className="p-2 hover:bg-red-50 text-red-600 rounded flex flex-col items-center w-14 disabled:opacity-40"
              >
                <Trash2 size={18} />
                <span className="text-[9px] mt-0.5">Eliminar</span>
              </button>
              <button 
                disabled={!hasFile}
                onClick={onInsertBlankPage}
                className="p-2 rounded flex flex-col items-center w-14 disabled:opacity-40 hover:bg-slate-100 text-slate-700"
                title="Insertar página en blanco"
              >
                <FilePlus size={18} />
                <span className="text-[9px] mt-0.5">Insertar</span>
              </button>
            </div>

            <div className="h-10 w-px bg-slate-200"></div>

            <button 
              onClick={onOpenMerge} 
              className="p-2 hover:bg-slate-100 rounded flex flex-col items-center text-slate-700"
            >
              <Combine size={18} className="text-emerald-600" />
              <span className="text-[9px] mt-0.5">Combinar PDFs</span>
            </button>
          </div>
        )}

        {/* TAB: COMENTARIOS */}
        {activeTab === 'comentarios' && (
          <div className="flex items-center space-x-4 animate-fade-in">
            {/* Herramientas de Marcado */}
            <div className="flex items-center space-x-1">
              <button 
                disabled={!hasFile}
                onClick={() => setActiveTool('drawing')} 
                className={`p-2 rounded flex flex-col items-center w-12 disabled:opacity-40 ${activeTool === 'drawing' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
              >
                <Pencil size={18} />
                <span className="text-[9px] mt-0.5">Lápiz</span>
              </button>
              <button 
                disabled={!hasFile}
                onClick={() => setActiveTool('text')} 
                className={`p-2 rounded flex flex-col items-center w-14 disabled:opacity-40 ${activeTool === 'text' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
              >
                <Type size={18} />
                <span className="text-[9px] mt-0.5">Nota</span>
              </button>
            </div>
            
            <div className="h-10 w-px bg-slate-200"></div>

            {/* Formas */}
            <div className="flex items-center space-x-1">
              <button 
                disabled={!hasFile}
                onClick={() => setActiveTool('shape-rect')} 
                className={`p-2 rounded flex flex-col items-center w-14 disabled:opacity-40 ${activeTool === 'shape-rect' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
              >
                <Square size={18} />
                <span className="text-[9px] mt-0.5">Rectángulo</span>
              </button>
              <button 
                disabled={!hasFile}
                onClick={() => setActiveTool('shape-circle')} 
                className={`p-2 rounded flex flex-col items-center w-14 disabled:opacity-40 ${activeTool === 'shape-circle' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
              >
                <Circle size={18} />
                <span className="text-[9px] mt-0.5">Círculo</span>
              </button>
              <button 
                disabled={!hasFile}
                onClick={() => setActiveTool('shape-line')} 
                className={`p-2 rounded flex flex-col items-center w-12 disabled:opacity-40 ${activeTool === 'shape-line' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
              >
                <Minus size={18} />
                <span className="text-[9px] mt-0.5">Línea</span>
              </button>
            </div>

            <div className="h-10 w-px bg-slate-200"></div>

            {/* Propiedades de lápiz/dibujo */}
            {hasFile && (activeTool === 'drawing' || activeTool === 'shape-rect' || activeTool === 'shape-circle' || activeTool === 'shape-line' || activeTool === 'text') && (
              <div className="flex items-center space-x-3 pl-2 animate-fade-in text-xs">
                {/* Color Selector */}
                <div className="flex flex-col">
                  <span className="text-[9px] text-slate-500 mb-0.5 font-medium">Color</span>
                  <div className="flex items-center space-x-1.5">
                    {['#e05307', '#0284c7', '#22c55e', '#ef4444', '#000000', '#facc15'].map((color) => (
                      <button 
                        key={color}
                        onClick={() => setDrawColor(color)}
                        style={{ backgroundColor: color }}
                        className={`w-4 h-4 rounded-full border transition-all ${
                          drawColor === color ? 'border-slate-800 scale-125 ring-2 ring-brand-300' : 'border-slate-300 hover:scale-110'
                        }`}
                      />
                    ))}
                    <input 
                      type="color" 
                      value={drawColor} 
                      onChange={(e) => setDrawColor(e.target.value)}
                      className="w-5 h-5 cursor-pointer border border-slate-300 rounded p-0 bg-transparent"
                    />
                  </div>
                </div>

                {/* stroke width / font size */}
                {activeTool === 'text' ? (
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-500 mb-0.5 font-medium">Tamaño Letra</span>
                    <select 
                      value={fontSize} 
                      onChange={(e) => setFontSize(Number(e.target.value))}
                      className="border border-slate-300 rounded px-1 py-0.5 text-xs bg-white text-slate-700 focus:outline-none"
                    >
                      {[10, 12, 14, 16, 18, 20, 24, 28, 36, 48].map((size) => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    <span className="text-[9px] text-slate-500 mb-0.5 font-medium">Grosor</span>
                    <select 
                      value={drawWidth} 
                      onChange={(e) => setDrawWidth(Number(e.target.value))}
                      className="border border-slate-300 rounded px-1 py-0.5 text-xs bg-white text-slate-700 focus:outline-none"
                    >
                      {[1, 2, 3, 5, 8, 12].map((w) => (
                        <option key={w} value={w}>{w}px</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB: FORMULARIOS */}
        {activeTab === 'formularios' && (
          <div className="flex items-center space-x-4 animate-fade-in">
            <button 
              disabled={!hasFile}
              onClick={() => setActiveTool('text')}
              className={`p-2 rounded flex flex-col items-center w-14 disabled:opacity-40 ${activeTool === 'text' ? 'bg-brand-100 text-brand-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
              title="Añadir campo de texto para rellenar"
            >
              <Type size={18} className="text-indigo-600" />
              <span className="text-[9px] mt-0.5">Campo Texto</span>
            </button>
            <div className="h-10 w-px bg-slate-200"></div>
            <span className="text-xs text-slate-400">Selecciona Lápiz o Texto para rellenar el formulario de forma interactiva.</span>
          </div>
        )}

        {/* TAB: PROTEGER */}
        {activeTab === 'proteger' && (
          <div className="flex items-center space-x-4 animate-fade-in">
            <button 
              disabled={!hasFile}
              onClick={onOpenSecurity}
              className="p-2 hover:bg-slate-100 rounded flex flex-col items-center text-slate-700 disabled:opacity-40"
            >
              <Lock size={18} className="text-red-600" />
              <span className="text-[9px] mt-0.5">Cifrar / Contraseña</span>
            </button>
            <div className="h-10 w-px bg-slate-200"></div>
            <button 
              disabled={!hasFile}
              onClick={() => setActiveTool('redact')}
              className={`p-2 rounded flex flex-col items-center w-14 disabled:opacity-40 ${activeTool === 'redact' ? 'bg-red-100 text-red-700 font-medium' : 'hover:bg-slate-100 text-slate-700'}`}
              title="Censura permanente de contenido"
            >
              <Square size={18} className="fill-black text-black" />
              <span className="text-[9px] mt-0.5">Censurar</span>
            </button>
          </div>
        )}

        {/* TAB: AYUDA */}
        {activeTab === 'ayuda' && (
          <div className="flex items-center space-x-4 animate-fade-in">
            <button 
              disabled={!hasFile}
              onClick={onOpenOCR}
              className="p-2 hover:bg-slate-100 rounded flex flex-col items-center text-slate-700 disabled:opacity-40"
            >
              <Cpu size={18} className="text-brand-600" />
              <span className="text-[9px] mt-0.5">Reconocimiento OCR</span>
            </button>
            <div className="h-10 w-px bg-slate-200"></div>
            <div className="flex items-center space-x-2 text-xs text-slate-500">
              <Info size={16} className="text-slate-400" />
              <span>Carga un documento PDF local para habilitar todas las herramientas de edición.</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
