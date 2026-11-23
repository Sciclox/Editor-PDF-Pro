import React, { useRef } from 'react';

interface TransformableProps {
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  selected: boolean;
  onSelect: () => void;
  onDrag: (dx: number, dy: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onResize: (newX: number, newY: number, newW: number, newH: number, handle: 'tl' | 'tr' | 'bl' | 'br') => void;
  onResizeEnd?: () => void;
  lockAspectRatio?: boolean;
  children: React.ReactNode;
  borderStyle?: 'dashed-blue' | 'solid-blue' | 'solid-black' | 'none';
}

export const Transformable: React.FC<TransformableProps> = ({
  x,
  y,
  w,
  h,
  scale,
  selected,
  onSelect,
  onDrag,
  onDragStart,
  onDragEnd,
  onResize,
  onResizeEnd,
  lockAspectRatio = false,
  children,
  borderStyle
}) => {
  const startPos = useRef<{ mouseX: number; mouseY: number; x: number; y: number; w: number; h: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag with left click
    if (e.button !== 0) return;
    
    e.stopPropagation();
    onSelect();
    
    onDragStart?.();
    
    startPos.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      x,
      y,
      w,
      h
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!startPos.current) return;
      const dx = (moveEvent.clientX - startPos.current.mouseX) / scale;
      const dy = (moveEvent.clientY - startPos.current.mouseY) / scale;
      onDrag(dx, dy);
    };

    const handleMouseUp = () => {
      startPos.current = null;
      onDragEnd?.();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleResizeMouseDown = (e: React.MouseEvent, handle: 'tl' | 'tr' | 'bl' | 'br') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    
    startPos.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      x,
      y,
      w,
      h
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!startPos.current) return;
      
      const dx = (moveEvent.clientX - startPos.current.mouseX) / scale;
      const dy = (moveEvent.clientY - startPos.current.mouseY) / scale;
      
      const aspect = startPos.current.w / startPos.current.h;

      let newX = startPos.current.x;
      let newY = startPos.current.y;
      let newW = startPos.current.w;
      let newH = startPos.current.h;

      if (handle === 'br') {
        newW = Math.max(10, startPos.current.w + dx);
        if (lockAspectRatio) {
          newH = newW / aspect;
        } else {
          newH = Math.max(10, startPos.current.h + dy);
        }
      } else if (handle === 'bl') {
        newW = Math.max(10, startPos.current.w - dx);
        if (lockAspectRatio) {
          newH = newW / aspect;
        } else {
          newH = Math.max(10, startPos.current.h + dy);
        }
        newX = startPos.current.x + (startPos.current.w - newW);
      } else if (handle === 'tr') {
        newW = Math.max(10, startPos.current.w + dx);
        if (lockAspectRatio) {
          newH = newW / aspect;
        } else {
          newH = Math.max(10, startPos.current.h - dy);
        }
        newY = startPos.current.y + (startPos.current.h - newH);
      } else if (handle === 'tl') {
        newW = Math.max(10, startPos.current.w - dx);
        if (lockAspectRatio) {
          newH = newW / aspect;
        } else {
          newH = Math.max(10, startPos.current.h - dy);
        }
        newX = startPos.current.x + (startPos.current.w - newW);
        newY = startPos.current.y + (startPos.current.h - newH);
      }

      onResize(newX, newY, newW, newH, handle);
    };

    const handleMouseUp = () => {
      startPos.current = null;
      onResizeEnd?.();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${x * scale}px`,
    top: `${y * scale}px`,
    width: `${w * scale}px`,
    height: `${h * scale}px`,
    pointerEvents: 'auto',
    ...(selected ? {
      boxShadow: '0 0 0 0.75px #0055ff',
      boxSizing: 'border-box' as const,
    } : (borderStyle === 'dashed-blue' || borderStyle === 'solid-blue' || borderStyle === 'solid-black') ? {
      border: borderStyle === 'dashed-blue' 
        ? '0.75px dashed #0055ff' 
        : borderStyle === 'solid-blue' 
          ? '0.75px solid #0055ff' 
          : '0.75px solid #000000',
      boxSizing: 'border-box' as const,
    } : {}),
  };

  return (
    <div 
      style={style}
      className={`absolute transition-shadow ${
        selected 
          ? 'shadow-sm z-50' 
          : (borderStyle === 'dashed-blue' || borderStyle === 'solid-blue' || borderStyle === 'solid-black')
            ? 'z-40'
            : 'hover:ring-1 hover:ring-[#0055ff]/40 hover:bg-[#0055ff]/5 z-40'
      }`}
      onMouseDown={handleMouseDown}
    >
      {/* Content wrapper */}
      <div className="w-full h-full relative cursor-move select-none">
        {children}
      </div>

      {/* Control handles */}
      {selected && (
        <>
          {/* Sleek Modern Square Handles (5px size, electric blue, 0.5px white border) */}
          <div 
            className="absolute cursor-nwse-resize z-50 hover:scale-125 shadow-sm transition-all"
            style={{ top: '-2.5px', left: '-2.5px', width: '5px', height: '5px', backgroundColor: '#0055ff', border: '0.5px solid #ffffff' }}
            onMouseDown={(e) => handleResizeMouseDown(e, 'tl')}
          />
          <div 
            className="absolute cursor-nesw-resize z-50 hover:scale-125 shadow-sm transition-all"
            style={{ top: '-2.5px', right: '-2.5px', width: '5px', height: '5px', backgroundColor: '#0055ff', border: '0.5px solid #ffffff' }}
            onMouseDown={(e) => handleResizeMouseDown(e, 'tr')}
          />
          <div 
            className="absolute cursor-nesw-resize z-50 hover:scale-125 shadow-sm transition-all"
            style={{ bottom: '-2.5px', left: '-2.5px', width: '5px', height: '5px', backgroundColor: '#0055ff', border: '0.5px solid #ffffff' }}
            onMouseDown={(e) => handleResizeMouseDown(e, 'bl')}
          />
          <div 
            className="absolute cursor-nwse-resize z-50 hover:scale-125 shadow-sm transition-all"
            style={{ bottom: '-2.5px', right: '-2.5px', width: '5px', height: '5px', backgroundColor: '#0055ff', border: '0.5px solid #ffffff' }}
            onMouseDown={(e) => handleResizeMouseDown(e, 'br')}
          />
        </>
      )}
    </div>
  );
};
