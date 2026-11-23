import React, { useState } from 'react';
import { 
  X, Lock, Tag, Cpu, Combine, Trash2, ArrowUp, ArrowDown, 
  Copy, Check, ShieldAlert, FileText, Info 
} from 'lucide-react';
import { mergePdfs } from '../utils/pdfCompiler';
import type { WatermarkSettings, SecuritySettings } from '../utils/pdfCompiler';
import Tesseract from 'tesseract.js';

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

// ==========================================
// 1. COMBINE / MERGE MODAL
// ==========================================
interface MergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadMergedPdf: (file: { name: string; path: string; data: Uint8Array }, docProxy: any) => void;
  darkMode: boolean;
  currentFile?: { name: string; path: string } | null;
  onGetCurrentBytes?: () => Promise<Uint8Array | null>;
}

interface MergeFileItem {
  name: string;
  path: string;
  data: Uint8Array;
  isCurrent?: boolean;
  isLoading?: boolean;
}

export const MergeModal: React.FC<MergeModalProps> = ({ 
  isOpen, 
  onClose, 
  onLoadMergedPdf, 
  darkMode,
  currentFile,
  onGetCurrentBytes
}) => {
  const [selectedFiles, setSelectedFiles] = useState<MergeFileItem[]>([]);
  const [isMerging, setIsMerging] = useState(false);

  // Initialize/reset files on modal open
  React.useEffect(() => {
    if (isOpen) {
      if (currentFile && onGetCurrentBytes) {
        // Initialize with the current edited file in a loading state
        const placeholder: MergeFileItem = {
          name: `${currentFile.name} (Documento actual en edición)`,
          path: currentFile.path || '',
          data: new Uint8Array(),
          isCurrent: true,
          isLoading: true
        };
        setSelectedFiles([placeholder]);

        // Asynchronously compile the edited bytes
        onGetCurrentBytes().then(bytes => {
          if (bytes) {
            setSelectedFiles(prev => prev.map(f => f.isCurrent ? { ...f, data: bytes, isLoading: false } : f));
          } else {
            // Failed, remove the placeholder
            setSelectedFiles(prev => prev.filter(f => !f.isCurrent));
            alert('No se pudo compilar el documento actual para fusionarlo.');
          }
        }).catch(err => {
          console.error('Error compiling current PDF for merge:', err);
          setSelectedFiles(prev => prev.filter(f => !f.isCurrent));
        });
      } else {
        setSelectedFiles([]);
      }
    }
  }, [isOpen, currentFile]);

  if (!isOpen) return null;

  const handleSelectFiles = async () => {
    if (window.electronAPI?.selectFilesToMerge) {
      try {
        const files = await window.electronAPI.selectFilesToMerge();
        if (files && files.length > 0) {
          // Robustly clean/verify files' data arrays (serialized typed arrays compatibility)
          const cleanedFiles = files.map((file: any) => {
            const bytes = safeToUint8Array(file.data);
            return {
              name: file.name,
              path: file.path,
              data: bytes
            };
          });
          setSelectedFiles(prev => [...prev, ...cleanedFiles]);
        }
      } catch (e: any) {
        alert('Error al seleccionar archivos: ' + e.message);
        console.error('Error selecting files to merge:', e);
      }
    } else {
      // Browser fallback: Select multiple files dynamically
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.pdf';
      input.onchange = async (e: any) => {
        const fileList = e.target.files;
        if (!fileList || fileList.length === 0) return;
        
        const newFiles: MergeFileItem[] = [];
        for (let i = 0; i < fileList.length; i++) {
          const file = fileList[i];
          try {
            const data = await new Promise<Uint8Array>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
              reader.onerror = () => reject(reader.error);
              reader.readAsArrayBuffer(file);
            });
            newFiles.push({
              name: file.name,
              path: '', // No absolute path in web browser
              data
            });
          } catch (fileErr) {
            console.error('Error reading file:', file.name, fileErr);
          }
        }
        setSelectedFiles(prev => [...prev, ...newFiles]);
      };
      input.click();
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const moveFile = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === selectedFiles.length - 1) return;

    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const updated = [...selectedFiles];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;
    setSelectedFiles(updated);
  };

  const handleMerge = async () => {
    const isAnyFileLoading = selectedFiles.some(f => f.isLoading);
    if (isAnyFileLoading) {
      alert('Por favor espera a que se termine de procesar el documento actual.');
      return;
    }

    if (selectedFiles.length < 2) {
      alert('Por favor selecciona al menos 2 archivos PDF para combinar.');
      return;
    }

    setIsMerging(true);
    try {
      // 1. Merge PDF byte arrays
      const mergedBytes = await mergePdfs(selectedFiles);

      // 2. Trigger saving
      if (window.electronAPI?.saveAs) {
        const saveResult = await window.electronAPI.saveAs(mergedBytes, 'documento_combinado.pdf');
        
        if (saveResult && saveResult.success && saveResult.path && saveResult.name) {
          // 3. Load merged PDF in main workspace
          const loadingTask = (window as any).pdfjsLib.getDocument({ data: mergedBytes });
          const doc = await loadingTask.promise;
          
          onLoadMergedPdf({
            name: saveResult.name,
            path: saveResult.path,
            data: mergedBytes
          }, doc);
          
          alert('Archivos combinados con éxito.');
          onClose();
        }
      } else {
        // Browser fallback: trigger download and load direct to workspace
        const blob = new Blob([mergedBytes as any], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'documento_combinado.pdf';
        a.click();
        URL.revokeObjectURL(url);

        // Load merged PDF in main workspace
        const loadingTask = (window as any).pdfjsLib.getDocument({ data: mergedBytes });
        const doc = await loadingTask.promise;
        
        onLoadMergedPdf({
          name: 'documento_combinado.pdf',
          path: '', // No absolute path in web browser
          data: mergedBytes
        }, doc);

        alert('Archivos combinados y descargados con éxito.');
        onClose();
      }
    } catch (e: any) {
      alert('Error al combinar PDFs: ' + e.message);
    } finally {
      setIsMerging(false);
    }
  };

  const isAnyFileLoading = selectedFiles.some(f => f.isLoading);

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center z-50 animate-fade-in p-4">
      <div className={`rounded-xl shadow-2xl border w-full max-w-lg overflow-hidden flex flex-col max-h-[500px] transition-colors duration-150 ${
        darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
      }`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between transition-colors duration-150 ${
          darkMode ? 'bg-slate-800/40 border-slate-800' : 'bg-slate-50 border-slate-200'
        }`}>
          <div className="flex items-center space-x-2">
            <Combine size={18} className="text-emerald-500" />
            <h3 className="font-bold text-sm">Combinar Múltiples PDFs</h3>
          </div>
          <button 
            onClick={onClose} 
            className={`p-1 rounded transition-colors ${
              darkMode ? 'hover:bg-slate-800 text-slate-400 hover:text-slate-200' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-700'
            }`}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Lista de documentos a fusionar</span>
            <button 
              onClick={handleSelectFiles}
              className={`px-3 py-1.5 text-xs font-bold rounded border transition-colors ${
                darkMode 
                  ? 'bg-brand-950/40 hover:bg-brand-900/50 text-brand-400 border-brand-900/50' 
                  : 'bg-brand-50 hover:bg-brand-100 text-brand-700 border-brand-200'
              }`}
            >
              + Agregar PDFs
            </button>
          </div>

          {selectedFiles.length === 0 ? (
            <div className={`border border-dashed rounded-lg p-10 text-center text-xs italic transition-colors ${
              darkMode ? 'border-slate-800 bg-slate-850/30 text-slate-500' : 'border-slate-200 bg-slate-50/50 text-slate-400'
            }`}>
              Presiona "+ Agregar PDFs" para seleccionar los archivos.
            </div>
          ) : (
            <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
              {selectedFiles.map((file, idx) => (
                <div 
                  key={idx} 
                  className={`flex items-center justify-between p-2.5 border rounded text-xs transition-colors ${
                    darkMode ? 'border-slate-800 bg-slate-800/40' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex items-center space-x-2 min-w-0 pr-4">
                    <FileText size={14} className={darkMode ? 'text-slate-500' : 'text-slate-400'} />
                    <span className={`truncate font-medium ${darkMode ? 'text-slate-200' : 'text-slate-700'}`}>{file.name}</span>
                    {file.isLoading && (
                      <span className="text-[10px] text-amber-500 animate-pulse font-semibold ml-2">(Procesando...)</span>
                    )}
                  </div>
                  <div className="flex items-center space-x-1 shrink-0">
                    <button 
                      onClick={() => moveFile(idx, 'up')}
                      disabled={idx === 0}
                      className={`p-1 rounded disabled:opacity-35 transition-colors ${
                        darkMode ? 'hover:bg-slate-700 text-slate-400 hover:text-slate-200' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button 
                      onClick={() => moveFile(idx, 'down')}
                      disabled={idx === selectedFiles.length - 1}
                      className={`p-1 rounded disabled:opacity-35 transition-colors ${
                        darkMode ? 'hover:bg-slate-700 text-slate-400 hover:text-slate-200' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <ArrowDown size={12} />
                    </button>
                    <button 
                      onClick={() => removeFile(idx)}
                      className={`p-1 rounded transition-colors ${
                        darkMode ? 'hover:bg-red-950/50 text-red-400 hover:text-red-300' : 'hover:bg-red-50 text-red-600'
                      }`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-5 py-3.5 border-t flex items-center justify-end space-x-3 transition-colors duration-150 ${
          darkMode ? 'bg-slate-800/40 border-slate-800' : 'bg-slate-50 border-slate-200'
        }`}>
          <button 
            onClick={onClose} 
            className={`px-4 py-2 border text-xs font-semibold rounded transition-colors ${
              darkMode ? 'border-slate-750 text-slate-300 hover:bg-slate-800' : 'border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            Cancelar
          </button>
          <button 
            onClick={handleMerge}
            disabled={selectedFiles.length < 2 || isMerging || isAnyFileLoading}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 disabled:opacity-50 text-white text-xs font-semibold rounded shadow-sm transition-colors flex items-center space-x-2"
          >
            {isMerging ? 'Combinando...' : isAnyFileLoading ? 'Procesando...' : 'Combinar y Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
};


// ==========================================
// 2. SECURITY / PASSWORD MODAL
// ==========================================
interface SecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
  security: SecuritySettings | null;
  setSecurity: (settings: SecuritySettings | null) => void;
  darkMode: boolean;
}

export const SecurityModal: React.FC<SecurityModalProps> = ({ isOpen, onClose, security, setSecurity }) => {
  const [userPassword, setUserPassword] = useState(security?.userPassword || '');
  const [ownerPassword, setOwnerPassword] = useState(security?.ownerPassword || '');

  if (!isOpen) return null;

  const handleApply = () => {
    if (userPassword.trim() === '' && ownerPassword.trim() === '') {
      setSecurity(null);
      alert('Configuración de seguridad eliminada.');
    } else {
      setSecurity({ userPassword, ownerPassword });
      alert('Seguridad configurada. Se aplicará al guardar el PDF.');
    }
    onClose();
  };

  const handleClear = () => {
    setUserPassword('');
    setOwnerPassword('');
    setSecurity(null);
    alert('Configuración de seguridad eliminada.');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center z-50 animate-fade-in p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-slate-50 px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-slate-800">
            <Lock size={18} className="text-red-600" />
            <h3 className="font-bold text-sm">Cifrar PDF con Contraseña</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 text-slate-500 rounded">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          <div className="flex items-start space-x-2 p-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg">
            <ShieldAlert size={16} className="shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Las contraseñas se incrustarán en el documento. Al abrir el PDF se solicitará la Contraseña de Apertura.
            </p>
          </div>

          <div className="space-y-3.5">
            <div className="flex flex-col">
              <label className="font-semibold text-slate-700 mb-1">Contraseña de Apertura (Usuario)</label>
              <input 
                type="password"
                placeholder="Dejar vacío si no deseas restringir lectura"
                value={userPassword}
                onChange={(e) => setUserPassword(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded focus:outline-none focus:border-red-500 bg-white text-slate-800"
              />
            </div>

            <div className="flex flex-col">
              <label className="font-semibold text-slate-700 mb-1">Contraseña de Permisos (Propietario)</label>
              <input 
                type="password"
                placeholder="Dejar vacío si no deseas restringir edición"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded focus:outline-none focus:border-red-500 bg-white text-slate-800"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-5 py-3.5 border-t border-slate-200 flex items-center justify-between">
          <button 
            onClick={handleClear}
            className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 font-semibold rounded transition-colors"
          >
            Quitar Seguridad
          </button>
          <div className="flex space-x-2">
            <button 
              onClick={onClose} 
              className="px-3.5 py-1.5 border border-slate-300 text-slate-700 font-semibold rounded hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            <button 
              onClick={handleApply}
              className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded shadow-sm transition-colors"
            >
              Configurar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


// ==========================================
// 3. WATERMARK MODAL
// ==========================================
interface WatermarkModalProps {
  isOpen: boolean;
  onClose: () => void;
  watermark: WatermarkSettings | null;
  setWatermark: (settings: WatermarkSettings | null) => void;
  darkMode: boolean;
}

export const WatermarkModal: React.FC<WatermarkModalProps> = ({ isOpen, onClose, watermark, setWatermark }) => {
  const [text, setText] = useState(watermark?.text || 'CONFIDENCIAL');
  const [color, setColor] = useState(watermark?.color || '#cfcfcf');
  const [fontSize, setFontSize] = useState(watermark?.fontSize || 48);
  const [opacity, setOpacity] = useState(watermark?.opacity || 0.3);
  const [angle, setAngle] = useState(watermark?.angle || 45);

  if (!isOpen) return null;

  const handleApply = () => {
    if (text.trim() === '') {
      setWatermark(null);
      alert('Marca de agua vacía. Se ha removido.');
    } else {
      setWatermark({ text, color, fontSize, opacity, angle });
      alert('Marca de agua configurada. Se aplicará a todo el documento al guardar.');
    }
    onClose();
  };

  const handleClear = () => {
    setWatermark(null);
    alert('Marca de agua removida.');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center z-50 animate-fade-in p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-slate-50 px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-slate-800">
            <Tag size={18} className="text-violet-600" />
            <h3 className="font-bold text-sm">Añadir Marca de Agua</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 text-slate-500 rounded">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-3.5 text-xs">
          <div className="flex flex-col">
            <label className="font-semibold text-slate-700 mb-1">Texto de la marca</label>
            <input 
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded focus:outline-none focus:border-violet-500 bg-white text-slate-800"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <label className="font-semibold text-slate-700 mb-1">Color</label>
              <div className="flex items-center space-x-2">
                <input 
                  type="color" 
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border border-slate-300 p-0 bg-transparent"
                />
                <span className="uppercase text-[11px] font-mono text-slate-500">{color}</span>
              </div>
            </div>

            <div className="flex flex-col">
              <label className="font-semibold text-slate-700 mb-1">Tamaño de letra</label>
              <input 
                type="number"
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="px-2 py-1 border border-slate-300 rounded focus:outline-none focus:border-violet-500 bg-white text-slate-800"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col">
              <label className="font-semibold text-slate-700 mb-1">Opacidad ({Math.round(opacity * 100)}%)</label>
              <input 
                type="range"
                min="0.05"
                max="1.0"
                step="0.05"
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="w-full cursor-pointer mt-1"
              />
            </div>

            <div className="flex flex-col">
              <label className="font-semibold text-slate-700 mb-1">Ángulo de inclinación ({angle}°)</label>
              <input 
                type="range"
                min="0"
                max="360"
                step="5"
                value={angle}
                onChange={(e) => setAngle(Number(e.target.value))}
                className="w-full cursor-pointer mt-1"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-5 py-3.5 border-t border-slate-200 flex items-center justify-between">
          <button 
            onClick={handleClear}
            className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 font-semibold rounded transition-colors"
          >
            Quitar Marca
          </button>
          <div className="flex space-x-2">
            <button 
              onClick={onClose} 
              className="px-3.5 py-1.5 border border-slate-300 text-slate-700 font-semibold rounded hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            <button 
              onClick={handleApply}
              className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded shadow-sm transition-colors"
            >
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


// ==========================================
// 4. OCR READER MODAL
// ==========================================
interface OCRModalProps {
  isOpen: boolean;
  onClose: () => void;
  darkMode: boolean;
}

export const OCRModal: React.FC<OCRModalProps> = ({ isOpen, onClose }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [extractedText, setExtractedText] = useState('');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const runOCR = async () => {
    // Locate the rendered PDF page canvas in the workspace
    const workspaceCanvas = document.querySelector('.pdf-page-container canvas') as HTMLCanvasElement;
    if (!workspaceCanvas) {
      alert('Error: No se encontró la página activa en el visualizador.');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setExtractedText('');
    setCopied(false);

    try {
      // Create a clean image source from canvas
      const imgDataUrl = workspaceCanvas.toDataURL('image/png');
      
      const result = await Tesseract.recognize(
        imgDataUrl,
        'spa+eng', // Spanish + English dictionaries
        {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              setProgress(Math.round(m.progress * 100));
            }
          }
        }
      );

      setExtractedText(result.data.text);
    } catch (e: any) {
      alert('Error al ejecutar OCR: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const copyToClipboard = () => {
    if (extractedText.trim() === '') return;
    navigator.clipboard.writeText(extractedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center z-50 animate-fade-in p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[500px]">
        {/* Header */}
        <div className="bg-slate-50 px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-slate-800">
            <Cpu size={18} className="text-brand-600" />
            <h3 className="font-bold text-sm">Reconocimiento Óptico de Caracteres (OCR)</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 text-slate-500 rounded">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 flex flex-col">
          <p className="text-xs text-slate-500 leading-relaxed">
            Analiza el lienzo visual de la página actual y extrae el texto contenido en ella utilizando OCR de Tesseract.js.
          </p>

          {extractedText === '' && !isProcessing && (
            <div className="flex-1 border border-dashed border-slate-200 rounded-lg p-12 text-center flex flex-col items-center justify-center bg-slate-50/50">
              <Cpu size={32} className="text-slate-300 mb-3" />
              <button 
                onClick={runOCR}
                className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded shadow-sm transition-colors"
              >
                Escanear Página Actual
              </button>
            </div>
          )}

          {isProcessing && (
            <div className="flex-1 border border-slate-200 rounded-lg p-10 flex flex-col items-center justify-center bg-slate-50/30">
              <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-brand-500 animate-spin mb-4" />
              <span className="text-xs font-semibold text-slate-600 mb-1">Escaneando caracteres...</span>
              <span className="text-[11px] font-bold text-brand-600">{progress}% completado</span>
              
              <div className="w-full bg-slate-200 rounded-full h-1.5 mt-3 max-w-[200px]">
                <div className="bg-brand-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {extractedText !== '' && (
            <div className="flex-1 flex flex-col space-y-2 min-h-0">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-500 uppercase">Texto Extraído</span>
                <button 
                  onClick={copyToClipboard}
                  className="px-2.5 py-1 text-[11px] font-medium border border-slate-300 rounded hover:bg-slate-100 text-slate-700 flex items-center space-x-1 transition-all"
                >
                  {copied ? (
                    <>
                      <Check size={12} className="text-green-600" />
                      <span className="text-green-600">¡Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Copiar Texto</span>
                    </>
                  )}
                </button>
              </div>
              <textarea 
                readOnly
                value={extractedText}
                className="flex-1 w-full border border-slate-300 rounded p-3 text-xs font-mono bg-slate-50 text-slate-800 focus:outline-none min-h-[180px] select-text"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-5 py-3.5 border-t border-slate-200 flex items-center justify-end">
          <button 
            onClick={onClose} 
            className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded hover:bg-slate-100 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 5. ALERT / DIALOG MODAL (PREMIUM FALLBACK)
// ==========================================
interface AlertModalProps {
  isOpen: boolean;
  message: string;
  onClose: () => void;
  darkMode: boolean;
}

export const AlertModal: React.FC<AlertModalProps> = ({ isOpen, message, onClose, darkMode }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center z-[100] animate-fade-in p-4">
      <div className={`rounded-xl shadow-2xl border w-full max-w-sm overflow-hidden flex flex-col transition-colors duration-150 ${
        darkMode ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
      }`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center space-x-2.5 transition-colors duration-150 ${
          darkMode ? 'bg-slate-850 border-slate-800' : 'bg-slate-50 border-slate-200'
        }`}>
          <Info size={18} className="text-brand-500 shrink-0" />
          <h3 className="font-bold text-sm">Notificación del Sistema</h3>
        </div>

        {/* Content */}
        <div className="p-6 text-xs leading-relaxed font-medium">
          {message}
        </div>

        {/* Footer */}
        <div className={`px-5 py-3 border-t flex justify-end transition-colors duration-150 ${
          darkMode ? 'bg-slate-850 border-slate-800' : 'bg-slate-50 border-slate-200'
        }`}>
          <button 
            onClick={onClose} 
            className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded shadow-sm transition-colors"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
};
