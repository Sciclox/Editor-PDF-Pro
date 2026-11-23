import React from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface StatusBarProps {
  selectedPage: number;
  pageCount: number;
  setSelectedPage: (page: number) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  hasFile: boolean;
  darkMode: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  selectedPage,
  pageCount,
  setSelectedPage,
  zoom,
  setZoom,
  hasFile
}) => {
  const handlePageInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const val = parseInt(e.currentTarget.value, 10);
      if (!isNaN(val) && val >= 1 && val <= pageCount) {
        setSelectedPage(val - 1);
      } else {
        e.currentTarget.value = (selectedPage + 1).toString();
      }
    }
  };

  const adjustZoom = (amount: number) => {
    const nextZoom = Math.min(400, Math.max(50, zoom + amount));
    setZoom(nextZoom);
  };

  return (
    <div className="bg-slate-900 text-slate-300 h-9 px-4 flex items-center justify-between text-xs select-none z-30">
      {/* Left section: page navigation */}
      <div className="flex items-center space-x-2">
        {hasFile && pageCount > 0 ? (
          <>
            <button 
              onClick={() => setSelectedPage(Math.max(0, selectedPage - 1))}
              disabled={selectedPage === 0}
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            
            <div className="flex items-center space-x-1">
              <span>Página</span>
              <input 
                type="text" 
                key={selectedPage} // Recreate input to refresh defaultValue
                defaultValue={selectedPage + 1}
                onKeyDown={handlePageInput}
                className="w-10 bg-slate-800 border border-slate-700 text-center rounded py-0.5 text-xs text-white focus:outline-none focus:border-brand-500 font-semibold"
              />
              <span>de {pageCount}</span>
            </div>

            <button 
              onClick={() => setSelectedPage(Math.min(pageCount - 1, selectedPage + 1))}
              disabled={selectedPage === pageCount - 1}
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </>
        ) : (
          <span className="text-[11px] text-slate-500 font-medium">Ningún documento abierto</span>
        )}
      </div>

      {/* Middle section: simple status text */}
      <div className="hidden sm:block text-[11px] text-slate-500 font-medium font-sans uppercase">
        {hasFile && 'Lienzo listo'}
      </div>

      {/* Right section: zoom options */}
      <div className="flex items-center space-x-3.5">
        {hasFile ? (
          <>
            <div className="flex items-center space-x-1.5">
              <button 
                onClick={() => adjustZoom(-10)} 
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
                title="Alejar"
              >
                <ZoomOut size={13} />
              </button>
              
              <input 
                type="range" 
                min="50" 
                max="400" 
                step="10"
                value={zoom} 
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-20 sm:w-28 cursor-pointer h-1 bg-slate-700 rounded-lg appearance-none accent-brand-500"
              />
              
              <button 
                onClick={() => adjustZoom(10)} 
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
                title="Acercar"
              >
                <ZoomIn size={13} />
              </button>
            </div>

            <div className="h-3 w-px bg-slate-700"></div>

            <div className="flex items-center space-x-1">
              <span className="font-semibold text-slate-200">{zoom}%</span>
              <button 
                onClick={() => setZoom(100)} 
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"
                title="Ajustar a 100%"
              >
                <Maximize2 size={13} />
              </button>
            </div>
          </>
        ) : (
          <span className="text-[10px] text-slate-600">Zoom: 100%</span>
        )}
      </div>
    </div>
  );
};
