import React, { useEffect, useRef, useState } from 'react';
import type { ActiveTool, ActiveTab, PDFFileState } from '../hooks/usePDFEditor';
import type { Annotation, PageModification } from '../utils/pdfCompiler';
import { Check, X, Loader2 } from 'lucide-react';
import { Transformable } from './Transformable';

// Helper to inject Google Fonts stylesheet dynamically
const loadGoogleFont = (fontName: string) => {
  const id = `gfont-${fontName.toLowerCase().replace(/\s+/g, '-')}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/\s+/g, '+')}:wght@400;700&display=swap`;
  document.head.appendChild(link);
};

// Robust UUID generator fallback for browser environment
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback to RFC4122 v4 compliance standard
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Helper to retrieve the actual PostScript/original font name from pdf.js page resources
const getRealFontName = (page: any, fontId: string): string => {
  try {
    if (page && page.commonObjs && page.commonObjs.has(fontId)) {
      const font = page.commonObjs.get(fontId);
      if (font && font.name) return font.name;
    }
    if (page && page.objs && page.objs.has(fontId)) {
      const font = page.objs.get(fontId);
      if (font && font.name) return font.name;
    }
  } catch (err) {
    console.warn('Error reading font name:', err);
  }
  return fontId;
};

// Extract both text color and background color from canvas pixel array (in-memory optimized CPU scan)
const getColorsFromFullImageData = (imgData: ImageData, x: number, y: number, w: number, h: number): { textColor: string; bgColor: string } => {
  const fallback = { textColor: '#000000', bgColor: '#ffffff' };
  try {
    const width = imgData.width;
    const height = imgData.height;
    const data = imgData.data;

    // Helper to safely clamp coordinate inputs to avoid index size errors
    const clampX = (val: number) => Math.max(0, Math.min(width - 1, Math.round(val)));
    const clampY = (val: number) => Math.max(0, Math.min(height - 1, Math.round(val)));

    // Pad the bounding box area to capture text that might be slightly outside due to descenders, ascenders, or rendering metrics.
    const padX = 3;
    const padY = 3;
    const rx = clampX(x - padX);
    const ry = clampY(y - padY);
    const rw = Math.max(1, Math.min(width - rx, Math.round(w + padX * 2)));
    const rh = Math.max(1, Math.min(height - ry, Math.round(h + padY * 2)));

    // 1. Sample corners of a slightly inset box to detect the text's immediate background color
    const inset = 1;
    const bx = clampX(x + inset);
    const by = clampY(y + inset);
    const bw = Math.max(1, Math.min(width - bx, Math.round(w - inset * 2)));
    const bh = Math.max(1, Math.min(height - by, Math.round(h - inset * 2)));

    // Count color bin frequencies to find the dominant background color of the bounding box
    const colorCounts: { [key: string]: { r: number; g: number; b: number; count: number } } = {};
    for (let currY = by; currY < by + bh; currY++) {
      for (let currX = bx; currX < bx + bw; currX++) {
        const i = (currY * width + currX) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 150) continue; // Ignore transparent/semi-transparent pixels

        // Bin colors (bin size 16) to group slightly varying pixels
        const br = Math.floor(r / 16);
        const bg_val = Math.floor(g / 16);
        const bb = Math.floor(b / 16);
        const key = `${br},${bg_val},${bb}`;
        if (!colorCounts[key]) {
          colorCounts[key] = { r: 0, g: 0, b: 0, count: 0 };
        }
        colorCounts[key].r += r;
        colorCounts[key].g += g;
        colorCounts[key].b += b;
        colorCounts[key].count++;
      }
    }

    let dominantColor = { r: 255, g: 255, b: 255 };
    let maxCount = 0;
    for (const key in colorCounts) {
      if (colorCounts[key].count > maxCount) {
        maxCount = colorCounts[key].count;
        dominantColor = {
          r: Math.round(colorCounts[key].r / colorCounts[key].count),
          g: Math.round(colorCounts[key].g / colorCounts[key].count),
          b: Math.round(colorCounts[key].b / colorCounts[key].count)
        };
      }
    }

    const corners = [
      { x: bx, y: by },
      { x: bx + bw - 1, y: by },
      { x: bx, y: by + bh - 1 },
      { x: bx + bw - 1, y: by + bh - 1 }
    ];
    const sampledCorners: { r: number; g: number; b: number }[] = [];
    corners.forEach(c => {
      const idx = (c.y * width + c.x) * 4;
      if (idx < data.length) {
        sampledCorners.push({
          r: data[idx],
          g: data[idx + 1],
          b: data[idx + 2]
        });
      }
    });

    // Filter corners by comparing them to the dominant color inside the bounding box.
    const validCorners: { r: number; g: number; b: number }[] = [];
    sampledCorners.forEach(c => {
      const distToDom = Math.sqrt(
        Math.pow(c.r - dominantColor.r, 2) +
        Math.pow(c.g - dominantColor.g, 2) +
        Math.pow(c.b - dominantColor.b, 2)
      );
      if (distToDom < 120) {
        validCorners.push(c);
      }
    });

    let bgR = dominantColor.r;
    let bgG = dominantColor.g;
    let bgB = dominantColor.b;

    if (validCorners.length > 0) {
      // Find the most representative corner among valid corners
      let bestCornerIndex = 0;
      let minTotalDist = Infinity;
      for (let i = 0; i < validCorners.length; i++) {
        let totalDist = 0;
        for (let j = 0; j < validCorners.length; j++) {
          if (i === j) continue;
          totalDist += Math.sqrt(
            Math.pow(validCorners[i].r - validCorners[j].r, 2) +
            Math.pow(validCorners[i].g - validCorners[j].g, 2) +
            Math.pow(validCorners[i].b - validCorners[j].b, 2)
          );
        }
        if (totalDist < minTotalDist) {
          minTotalDist = totalDist;
          bestCornerIndex = i;
        }
      }
      
      // Average only the valid corners that are close to the best corner (distance < 50)
      const representative = validCorners[bestCornerIndex];
      let sumBgR = 0, sumBgG = 0, sumBgB = 0, bgCount = 0;
      validCorners.forEach(c => {
        const dist = Math.sqrt(
          Math.pow(c.r - representative.r, 2) +
          Math.pow(c.g - representative.g, 2) +
          Math.pow(c.b - representative.b, 2)
        );
        if (dist < 50) {
          sumBgR += c.r;
          sumBgG += c.g;
          sumBgB += c.b;
          bgCount++;
        }
      });
      if (bgCount > 0) {
        bgR = Math.round(sumBgR / bgCount);
        bgG = Math.round(sumBgG / bgCount);
        bgB = Math.round(sumBgB / bgCount);
      }
    }

    // Clean background scan noise close to pure white
    if (bgR > 242 && bgG > 242 && bgB > 242 && (Math.max(bgR, bgG, bgB) - Math.min(bgR, bgG, bgB)) < 4) {
      bgR = 255;
      bgG = 255;
      bgB = 255;
    }

    const toHex = (c: number) => c.toString(16).padStart(2, '0');
    const bgHex = `#${toHex(bgR)}${toHex(bgG)}${toHex(bgB)}`;

    // 2. Identify candidate text pixels
    let candidates: { r: number; g: number; b: number; dist: number }[] = [];

    for (let currY = ry; currY < ry + rh; currY++) {
      for (let currX = rx; currX < rx + rw; currX++) {
        const i = (currY * width + currX) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        const dist = Math.sqrt(
          Math.pow(r - bgR, 2) +
          Math.pow(g - bgG, 2) +
          Math.pow(b - bgB, 2)
        );

        if (a > 100 && dist > 10) {
          candidates.push({ r, g, b, dist });
        }
      }
    }

    const bgLuminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
    const fallbackTextColor = bgLuminance < 128 ? '#ffffff' : '#000000';

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.dist - a.dist);
      if (candidates[0].dist < 15) {
        return { textColor: fallbackTextColor, bgColor: bgHex };
      }

      const topPercent = 0.15;
      const topCount = Math.max(1, Math.min(candidates.length, Math.max(5, Math.round(candidates.length * topPercent))));

      let sumR = 0, sumG = 0, sumB = 0;
      for (let i = 0; i < topCount; i++) {
        sumR += candidates[i].r;
        sumG += candidates[i].g;
        sumB += candidates[i].b;
      }

      const avgR = Math.round(sumR / topCount);
      const avgG = Math.round(sumG / topCount);
      const avgB = Math.round(sumB / topCount);
      
      return {
        textColor: `#${toHex(avgR)}${toHex(avgG)}${toHex(avgB)}`,
        bgColor: bgHex
      };
    }

    return { textColor: fallbackTextColor, bgColor: bgHex };
  } catch (e) {
    console.error('Error getting colors from image data:', e);
    return fallback;
  }
};

const getPointsBoundingBox = (points: { x: number; y: number }[]) => {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX,
    y: minY,
    w: Math.max(10, maxX - minX),
    h: Math.max(10, maxY - minY)
  };
};

interface SnapResult {
  x: number;
  y: number;
  guideLeft: number | null;
  guideCenterX: number | null;
  guideRight: number | null;
  guideTop: number | null;
  guideCenterY: number | null;
  guideBottom: number | null;
}

const calculateSnapping = (
  draggedId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
  otherAnnotations: Annotation[],
  textItems: any[],
  pageWidth: number,
  pageHeight: number
): SnapResult => {
  const threshold = 5 / scale; // 5 screen pixels of snapping radius
  
  let snappedX = x;
  let snappedY = y;
  
  let guideLeft: number | null = null;
  let guideCenterX: number | null = null;
  let guideRight: number | null = null;
  let guideTop: number | null = null;
  let guideCenterY: number | null = null;
  let guideBottom: number | null = null;

  // Dragged boundaries
  const left = x;
  const centerX = x + w / 2;
  const right = x + w;

  const top = y;
  const centerY = y + h / 2;
  const bottom = y + h;

  // --- Vertical Snapping (X-axis alignment) ---
  const xTargets: { value: number; type: 'left' | 'center' | 'right' }[] = [
    { value: 0, type: 'left' },
    { value: pageWidth / 2, type: 'center' },
    { value: pageWidth, type: 'right' }
  ];

  otherAnnotations.forEach(ann => {
    if (ann.id === draggedId) return;
    if (ann.type === 'drawing') {
      const box = getPointsBoundingBox((ann as any).points);
      xTargets.push({ value: box.x, type: 'left' });
      xTargets.push({ value: box.x + box.w / 2, type: 'center' });
      xTargets.push({ value: box.x + box.w, type: 'right' });
    } else {
      const anyAnn = ann as any;
      const annW = anyAnn.w || (anyAnn.fontSize ? 200 : 50);
      xTargets.push({ value: anyAnn.x, type: 'left' });
      xTargets.push({ value: anyAnn.x + annW / 2, type: 'center' });
      xTargets.push({ value: anyAnn.x + annW, type: 'right' });
    }
  });

  textItems.forEach(item => {
    xTargets.push({ value: item.vx, type: 'left' });
    xTargets.push({ value: item.vx + item.vw / 2, type: 'center' });
    xTargets.push({ value: item.vx + item.vw, type: 'right' });
  });

  // Find closest X target within threshold
  let minDiffX = Infinity;
  xTargets.forEach(target => {
    // Check match against left
    const diffLeft = Math.abs(left - target.value);
    if (diffLeft < threshold && diffLeft < minDiffX) {
      minDiffX = diffLeft;
      snappedX = target.value;
      guideLeft = target.value;
      guideCenterX = null;
      guideRight = null;
    }
    // Check match against center
    const diffCenter = Math.abs(centerX - target.value);
    if (diffCenter < threshold && diffCenter < minDiffX) {
      minDiffX = diffCenter;
      snappedX = target.value - w / 2;
      guideLeft = null;
      guideCenterX = target.value;
      guideRight = null;
    }
    // Check match against right
    const diffRight = Math.abs(right - target.value);
    if (diffRight < threshold && diffRight < minDiffX) {
      minDiffX = diffRight;
      snappedX = target.value - w;
      guideLeft = null;
      guideCenterX = null;
      guideRight = target.value;
    }
  });

  // --- Horizontal Snapping (Y-axis alignment) ---
  const yTargets: { value: number; type: 'top' | 'center' | 'bottom' }[] = [
    { value: 0, type: 'top' },
    { value: pageHeight / 2, type: 'center' },
    { value: pageHeight, type: 'bottom' }
  ];

  otherAnnotations.forEach(ann => {
    if (ann.id === draggedId) return;
    if (ann.type === 'drawing') {
      const box = getPointsBoundingBox((ann as any).points);
      yTargets.push({ value: box.y, type: 'top' });
      yTargets.push({ value: box.y + box.h / 2, type: 'center' });
      yTargets.push({ value: box.y + box.h, type: 'bottom' });
    } else {
      const anyAnn = ann as any;
      const annH = anyAnn.h || (anyAnn.fontSize ? (anyAnn.fontSize * 1.3) : 50);
      yTargets.push({ value: anyAnn.y, type: 'top' });
      yTargets.push({ value: anyAnn.y + annH / 2, type: 'center' });
      yTargets.push({ value: anyAnn.y + annH, type: 'bottom' });
    }
  });

  textItems.forEach(item => {
    yTargets.push({ value: item.vy, type: 'top' });
    yTargets.push({ value: item.vy + item.vh / 2, type: 'center' });
    yTargets.push({ value: item.vy + item.vh, type: 'bottom' });
  });

  // Find closest Y target within threshold
  let minDiffY = Infinity;
  yTargets.forEach(target => {
    // Check match against top
    const diffTop = Math.abs(top - target.value);
    if (diffTop < threshold && diffTop < minDiffY) {
      minDiffY = diffTop;
      snappedY = target.value;
      guideTop = target.value;
      guideCenterY = null;
      guideBottom = null;
    }
    // Check match against center
    const diffCenter = Math.abs(centerY - target.value);
    if (diffCenter < threshold && diffCenter < minDiffY) {
      minDiffY = diffCenter;
      snappedY = target.value - h / 2;
      guideTop = null;
      guideCenterY = target.value;
      guideBottom = null;
    }
    // Check match against bottom
    const diffBottom = Math.abs(bottom - target.value);
    if (diffBottom < threshold && diffBottom < minDiffY) {
      minDiffY = diffBottom;
      snappedY = target.value - h;
      guideTop = null;
      guideCenterY = null;
      guideBottom = target.value;
    }
  });

  return {
    x: snappedX,
    y: snappedY,
    guideLeft,
    guideCenterX,
    guideRight,
    guideTop,
    guideCenterY,
    guideBottom
  };
};

interface WorkspaceProps {
  pdfFile: PDFFileState | null;
  pdfDoc: any;
  pageOrder: number[];
  pageMods: Record<number, PageModification>;
  annotations: Record<number, Annotation[]>;
  selectedPage: number;
  zoom: number;
  activeTool: ActiveTool;
  drawColor: string;
  drawWidth: number;
  fontSize: number;
  addAnnotation: (origIdx: number, ann: Annotation) => void;
  removeAnnotation: (origIdx: number, id: string) => void;
  updateAnnotation: (origIdx: number, id: string, updates: Partial<Annotation>, skipHistory?: boolean) => void;
  reorderAnnotations: (origIdx: number, newAnns: Annotation[]) => void;
  selectedSignature: string | null;
  setActiveTool: (tool: ActiveTool) => void;
  replaceDocumentText?: (pageIndex: number, oldText: string, newText: string, targetIndex?: number) => Promise<boolean>;
  replaceMultipleDocumentTexts?: (pageIndex: number, replacements: Array<{ oldText: string; newText: string; targetIndex?: number }>) => Promise<boolean>;
  setZoom: (zoom: number | ((prev: number) => number)) => void;

  isEditingAll: boolean;
  convertedPages: Record<number, boolean>;
  setConvertedPages: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  activeTab: ActiveTab;

  selectedAnnId: string | null;
  setSelectedAnnId: (id: string | null) => void;
}



export const Workspace: React.FC<WorkspaceProps> = ({
  pdfFile,
  pdfDoc,
  pageOrder,
  pageMods,
  annotations,
  selectedPage,
  zoom,
  activeTool,
  drawColor,
  drawWidth,
  fontSize,
  addAnnotation,
  removeAnnotation,
  updateAnnotation,
  selectedSignature,
  setActiveTool,
  setZoom,
  isEditingAll,
  convertedPages,
  setConvertedPages,
  activeTab,
  selectedAnnId,
  setSelectedAnnId
}) => {
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [isRendering, setIsRendering] = useState(false);
  
  // Refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<{ x: number; y: number }[]>([]);
  
  // Shape drawing state
  const [shapeStart, setShapeStart] = useState<{ x: number; y: number } | null>(null);
  const [tempShape, setTempShape] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Text input state
  const [activeTextInput, setActiveTextInput] = useState<{ x: number; y: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState('');

  // Text editing state (edit existing PDF text)
  const [textItems, setTextItems] = useState<any[]>([]);
  const [editTextValue, setEditTextValue] = useState('');

  // Object editing / Selection states
  const [editingAnnId, setEditingAnnId] = useState<string | null>(null);
  const [canvasTrigger, setCanvasTrigger] = useState(0);
  const [convertingTextIndex, setConvertingTextIndex] = useState<number | null>(null);
  const [clipboard, setClipboard] = useState<Annotation | null>(null);

  // Alignment guide lines state
  const [alignmentGuides, setAlignmentGuides] = useState<{
    showVertical: boolean;
    showHorizontal: boolean;
    x: number;
    y: number;
    w: number;
    h: number;
  }>({
    showVertical: false,
    showHorizontal: false,
    x: 0,
    y: 0,
    w: 0,
    h: 0
  });

  const originalPageIndex = pageOrder[selectedPage];

  // Load Google Fonts for text annotations dynamically in browser
  useEffect(() => {
    const pageAnns = annotations[originalPageIndex] || [];
    pageAnns.forEach(ann => {
      if (ann.type === 'text' && ann.fontFamily) {
        const fam = ann.fontFamily;
        if (['Roboto', 'Montserrat', 'Playfair Display', 'Pacifico', 'Lobster'].includes(fam)) {
          loadGoogleFont(fam);
        }
      }
    });
  }, [annotations, originalPageIndex]);

  // Duplicate selected annotation (Ctrl+D / Floating button)
  const handleDuplicateAnnotation = (annId: string) => {
    const pageAnns = annotations[originalPageIndex] || [];
    const targetAnn = pageAnns.find(ann => ann.id === annId);
    if (!targetAnn) return;

    const duplicate: Annotation = JSON.parse(JSON.stringify(targetAnn));
    duplicate.id = generateUUID();
    
    if ('x' in duplicate && 'y' in duplicate) {
      duplicate.x = (duplicate.x || 0) + 15;
      duplicate.y = (duplicate.y || 0) + 15;
    } else if (duplicate.type === 'drawing' && duplicate.points) {
      duplicate.points = duplicate.points.map(p => ({ x: p.x + 15, y: p.y + 15 }));
    }

    addAnnotation(originalPageIndex, duplicate);
    setSelectedAnnId(duplicate.id);
  };



  // Helper to calculate bounding box of drawing points
  const getDrawingBoundingBox = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return {
      x: minX,
      y: minY,
      w: Math.max(10, maxX - minX),
      h: Math.max(10, maxY - minY)
    };
  };

  const handleAnnotationDrag = (ann: Annotation, dx: number, dy: number) => {
    const anyAnn = ann as any;
    let originalX = anyAnn.x;
    let originalY = anyAnn.y;
    let width = anyAnn.w;
    let height = anyAnn.h;
    const currentScale = zoom / 100;

    if (ann.type === 'text') {
      width = anyAnn.w || 200;
      height = anyAnn.h || (anyAnn.fontSize * 1.3);
    } else if (ann.type === 'drawing') {
      const box = getDrawingBoundingBox(anyAnn.points);
      originalX = box.x;
      originalY = box.y;
      width = box.w;
      height = box.h;
    }

    const proposedX = originalX + dx;
    const proposedY = originalY + dy;

    const snapResult = calculateSnapping(
      ann.id,
      proposedX,
      proposedY,
      width,
      height,
      currentScale,
      pageAnns,
      textItems,
      pageDimensions.width / currentScale,
      pageDimensions.height / currentScale
    );

    // Apply snapResult updates to coordinates
    if (ann.type === 'drawing') {
      const snapDx = snapResult.x - originalX;
      const snapDy = snapResult.y - originalY;
      const updatedPoints = (ann as any).points.map((p: any) => ({
        x: p.x + snapDx,
        y: p.y + snapDy
      }));
      updateAnnotation(originalPageIndex, ann.id, {
        points: updatedPoints
      });
    } else {
      updateAnnotation(originalPageIndex, ann.id, {
        x: snapResult.x,
        y: snapResult.y
      });
    }

    // Determine if vertical or horizontal snapping is active
    const hasVerticalSnap = snapResult.guideLeft !== null || snapResult.guideCenterX !== null || snapResult.guideRight !== null;
    const hasHorizontalSnap = snapResult.guideTop !== null || snapResult.guideCenterY !== null || snapResult.guideBottom !== null;

    // Set guide lines state
    setAlignmentGuides({
      showVertical: hasVerticalSnap,
      showHorizontal: hasHorizontalSnap,
      x: snapResult.x,
      y: snapResult.y,
      w: width,
      h: height
    });
  };

  const handleAnnotationDragEnd = () => {
    setAlignmentGuides({
      showVertical: false,
      showHorizontal: false,
      x: 0,
      y: 0,
      w: 0,
      h: 0
    });
    setCanvasTrigger(prev => prev + 1);
  };

  const handleAnnotationResize = (
    ann: Annotation,
    newX: number,
    newY: number,
    newW: number,
    newH: number,
    handle: 'tl' | 'tr' | 'bl' | 'br'
  ) => {
    const currentScale = zoom / 100;
    const threshold = 5 / currentScale; // 5 screen pixels snapping threshold

    const pageAnns = annotations[originalPageIndex] || [];
    const pageWidth = pageDimensions.width / currentScale;
    const pageHeight = pageDimensions.height / currentScale;

    // Get current annotation coordinates securely depending on type
    let annX = 0;
    let annY = 0;
    let annW = 0;
    let annH = 0;
    if (ann.type === 'drawing') {
      const box = getDrawingBoundingBox(ann.points);
      annX = box.x;
      annY = box.y;
      annW = box.w;
      annH = box.h;
    } else {
      const anyAnn = ann as any;
      annX = anyAnn.x || 0;
      annY = anyAnn.y || 0;
      annW = anyAnn.w || 0;
      annH = anyAnn.h || 0;
    }

    // Snapping targets lists
    const xTargets: number[] = [0, pageWidth / 2, pageWidth];
    pageAnns.forEach(other => {
      if (other.id === ann.id) return;
      if (other.type === 'drawing') {
        const box = getDrawingBoundingBox((other as any).points);
        xTargets.push(box.x, box.x + box.w / 2, box.x + box.w);
      } else {
        const anyOther = other as any;
        const oW = anyOther.w || 50;
        xTargets.push(anyOther.x, anyOther.x + oW / 2, anyOther.x + oW);
      }
    });
    textItems.forEach(item => {
      xTargets.push(item.vx, item.vx + item.vw / 2, item.vx + item.vw);
    });

    const yTargets: number[] = [0, pageHeight / 2, pageHeight];
    pageAnns.forEach(other => {
      if (other.id === ann.id) return;
      if (other.type === 'drawing') {
        const box = getDrawingBoundingBox((other as any).points);
        yTargets.push(box.y, box.y + box.h / 2, box.y + box.h);
      } else {
        const anyOther = other as any;
        const oH = anyOther.h || 20;
        yTargets.push(anyOther.y, anyOther.y + oH / 2, anyOther.y + oH);
      }
    });
    textItems.forEach(item => {
      yTargets.push(item.vy, item.vy + item.vh / 2, item.vy + item.vh);
    });

    let snappedX = newX;
    let snappedY = newY;
    let snappedW = newW;
    let snappedH = newH;

    let guideLeft: number | null = null;
    let guideRight: number | null = null;
    let guideTop: number | null = null;
    let guideBottom: number | null = null;

    // --- SNAP X BOUNDARIES ---
    if (handle === 'br' || handle === 'tr') {
      // Snapping the right edge: (newX + newW)
      const rightEdgeProposed = newX + newW;
      let minDiff = Infinity;
      let closestTarget: number | null = null;
      xTargets.forEach(target => {
        const diff = Math.abs(rightEdgeProposed - target);
        if (diff < threshold && diff < minDiff) {
          minDiff = diff;
          closestTarget = target;
        }
      });
      if (closestTarget !== null) {
        snappedW = closestTarget - newX;
        guideRight = closestTarget;
      }
    } else if (handle === 'bl' || handle === 'tl') {
      // Snapping the left edge: (newX)
      // The right edge stays constant: (annX + annW)
      const rightEdgeConst = annX + annW; 
      const leftEdgeProposed = newX;
      let minDiff = Infinity;
      let closestTarget: number | null = null;
      xTargets.forEach(target => {
        const diff = Math.abs(leftEdgeProposed - target);
        if (diff < threshold && diff < minDiff) {
          minDiff = diff;
          closestTarget = target;
        }
      });
      if (closestTarget !== null) {
        snappedX = closestTarget;
        snappedW = rightEdgeConst - closestTarget;
        guideLeft = closestTarget;
      }
    }

    // --- SNAP Y BOUNDARIES ---
    if (handle === 'br' || handle === 'bl') {
      // Snapping the bottom edge: (newY + newH)
      const bottomEdgeProposed = newY + newH;
      let minDiff = Infinity;
      let closestTarget: number | null = null;
      yTargets.forEach(target => {
        const diff = Math.abs(bottomEdgeProposed - target);
        if (diff < threshold && diff < minDiff) {
          minDiff = diff;
          closestTarget = target;
        }
      });
      if (closestTarget !== null) {
        snappedH = closestTarget - newY;
        guideBottom = closestTarget;
      }
    } else if (handle === 'tr' || handle === 'tl') {
      // Snapping the top edge: (newY)
      // The bottom edge stays constant: (annY + annH)
      const bottomEdgeConst = annY + annH;
      const topEdgeProposed = newY;
      let minDiff = Infinity;
      let closestTarget: number | null = null;
      yTargets.forEach(target => {
        const diff = Math.abs(topEdgeProposed - target);
        if (diff < threshold && diff < minDiff) {
          minDiff = diff;
          closestTarget = target;
        }
      });
      if (closestTarget !== null) {
        snappedY = closestTarget;
        snappedH = bottomEdgeConst - closestTarget;
        guideTop = closestTarget;
      }
    }

    // Ensure sizes don't shrink to 0
    snappedW = Math.max(10, snappedW);
    snappedH = Math.max(10, snappedH);

    // Update annotation coordinates
    if (ann.type === 'drawing') {
      const box = getDrawingBoundingBox((ann as any).points);
      const scaleX = snappedW / box.w;
      const scaleY = snappedH / box.h;
      const updatedPoints = (ann as any).points.map((p: any) => ({
        x: snappedX + (p.x - box.x) * scaleX,
        y: snappedY + (p.y - box.y) * scaleY
      }));
      updateAnnotation(originalPageIndex, ann.id, {
        points: updatedPoints
      });
    } else {
      updateAnnotation(originalPageIndex, ann.id, {
        x: snappedX,
        y: snappedY,
        w: snappedW,
        h: snappedH
      });
    }

    // Set alignment guides state
    setAlignmentGuides({
      showVertical: guideLeft !== null || guideRight !== null,
      showHorizontal: guideTop !== null || guideBottom !== null,
      x: snappedX,
      y: snappedY,
      w: snappedW,
      h: snappedH
    });
  };

  const handleAnnotationResizeEnd = () => {
    setAlignmentGuides({
      showVertical: false,
      showHorizontal: false,
      x: 0,
      y: 0,
      w: 0,
      h: 0
    });
    setCanvasTrigger(prev => prev + 1);
  };

  // Clear selection on page/tool change
  useEffect(() => {
    setSelectedAnnId(null);
    setEditingAnnId(null);
  }, [selectedPage, activeTool]);

  // Global hotkeys (Delete, Copy, Paste, Duplicate, Arrow nudging)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl && 
        (activeEl.tagName === 'INPUT' || 
         activeEl.tagName === 'TEXTAREA' || 
         (activeEl as HTMLElement).contentEditable === 'true')
      ) {
        return;
      }

      const pageAnns = annotations[originalPageIndex] || [];

      // 1. Arrow Nudging
      if (selectedAnnId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const targetAnn = pageAnns.find(ann => ann.id === selectedAnnId);
        if (targetAnn) {
          const shiftValue = e.shiftKey ? 10 : 1;
          let dx = 0;
          let dy = 0;
          if (e.key === 'ArrowUp') dy = -shiftValue;
          if (e.key === 'ArrowDown') dy = shiftValue;
          if (e.key === 'ArrowLeft') dx = -shiftValue;
          if (e.key === 'ArrowRight') dx = shiftValue;

          if ('x' in targetAnn && 'y' in targetAnn) {
            updateAnnotation(originalPageIndex, selectedAnnId, {
              x: (targetAnn.x || 0) + dx,
              y: (targetAnn.y || 0) + dy
            });
          } else if (targetAnn.type === 'drawing' && targetAnn.points) {
            const updatedPoints = targetAnn.points.map(p => ({
              x: p.x + dx,
              y: p.y + dy
            }));
            updateAnnotation(originalPageIndex, selectedAnnId, {
              points: updatedPoints
            });
          }
        }
        return;
      }

      // 2. Delete / Backspace
      if (selectedAnnId && (e.key === 'Delete' || e.key === 'Backspace')) {
        removeAnnotation(originalPageIndex, selectedAnnId);
        setSelectedAnnId(null);
        return;
      }

      // 3. Copy (Ctrl+C)
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        if (selectedAnnId) {
          const targetAnn = pageAnns.find(ann => ann.id === selectedAnnId);
          if (targetAnn) {
            setClipboard(targetAnn);
          }
        }
        return;
      }

      // 4. Paste (Ctrl+V)
      if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
        if (clipboard) {
          const pasteAnn: Annotation = JSON.parse(JSON.stringify(clipboard));
          pasteAnn.id = generateUUID();
          if ('x' in pasteAnn && 'y' in pasteAnn) {
            pasteAnn.x = (pasteAnn.x || 0) + 15;
            pasteAnn.y = (pasteAnn.y || 0) + 15;
          } else if (pasteAnn.type === 'drawing' && pasteAnn.points) {
            pasteAnn.points = pasteAnn.points.map(p => ({ x: p.x + 15, y: p.y + 15 }));
          }
          addAnnotation(originalPageIndex, pasteAnn);
          setSelectedAnnId(pasteAnn.id);
        }
        return;
      }

      // 5. Duplicate (Ctrl+D)
      if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
        if (selectedAnnId) {
          e.preventDefault();
          handleDuplicateAnnotation(selectedAnnId);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    selectedAnnId, 
    activeTextInput, 
    editingAnnId, 
    originalPageIndex, 
    removeAnnotation, 
    annotations, 
    updateAnnotation, 
    clipboard, 
    addAnnotation
  ]);

  // Zoom on Ctrl + Mouse Wheel
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY;
        setZoom(prevZoom => {
          const factor = delta < 0 ? 1.15 : 0.85;
          const newZoom = Math.round(prevZoom * factor);
          return Math.max(25, Math.min(500, newZoom));
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [setZoom]);

  // Render PDF Page
  useEffect(() => {
    if (!pdfDoc || pageOrder.length === 0 || selectedPage >= pageOrder.length) return;

    const renderPage = async () => {
      setIsRendering(true);
      try {
        const pageNum = originalPageIndex + 1;
        const page = await pdfDoc.getPage(pageNum);
        const mods = pageMods[originalPageIndex];
        const rotation = mods ? mods.rotation : 0;
        
        const scale = zoom / 100;
        const viewport = page.getViewport({ scale, rotation });
        
        setPageDimensions({ width: viewport.width, height: viewport.height });

        const canvas = canvasRef.current;
        if (!canvas) return;

        const devicePixelRatio = window.devicePixelRatio || 1;
        canvas.width = viewport.width * devicePixelRatio;
        canvas.height = viewport.height * devicePixelRatio;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.scale(devicePixelRatio, devicePixelRatio);

        // Override text rendering on canvas to skip drawing text in edited or moved regions
        const originalFillText = ctx.fillText;
        const originalStrokeText = ctx.strokeText;
        
        const pageAnns = annotations[originalPageIndex] || [];
        const modifiedAnns = pageAnns.filter(ann => {
          if (ann.type !== 'text') return false;
          // Hide all text annotations on the canvas when in edit mode
          const isEditMode = isEditingAll || activeTab === 'editar';
          if (isEditMode) return true;

          const textAnn = ann as any;
          const origX = textAnn.originalX !== undefined ? textAnn.originalX : textAnn.x;
          const origY = textAnn.originalY !== undefined ? textAnn.originalY : textAnn.y;
          return textAnn.text !== textAnn.originalText || 
                 Math.abs(textAnn.x - origX) > 0.1 || 
                 Math.abs(textAnn.y - origY) > 0.1 ||
                 ann.id === editingAnnId;
        });

        if (isEditingAll) {
          ctx.fillText = function() {};
          ctx.strokeText = function() {};
        } else {
          const checkInsideModified = (x: number, y: number): boolean => {
            const transform = ctx.getTransform();
            const vx = (x * transform.a + y * transform.c + transform.e) / devicePixelRatio;
            const vy = (x * transform.b + y * transform.d + transform.f) / devicePixelRatio;
            
            return modifiedAnns.some(ann => {
              const textAnn = ann as any;
              const origX = textAnn.originalX !== undefined ? textAnn.originalX : textAnn.x;
              const origY = textAnn.originalY !== undefined ? textAnn.originalY : textAnn.y;
              const origW = textAnn.originalWidth !== undefined ? textAnn.originalWidth : (textAnn.w || 200);
              const origH = textAnn.originalHeight !== undefined ? textAnn.originalHeight : (textAnn.h || (textAnn.fontSize * 1.3));
              
              const ax1 = origX * scale;
              const ay1 = origY * scale;
              const ax2 = (origX + origW) * scale;
              const ay2 = (origY + origH) * scale;
              
              // We add a minor padding margin of 2px to ensure full containment
              return vx >= ax1 - 2 && vx <= ax2 + 2 && vy >= ay1 - 2 && vy <= ay2 + 2;
            });
          };

          ctx.fillText = function(text, x, y, maxWidth) {
            if (!checkInsideModified(x, y)) {
              originalFillText.call(this, text, x, y, maxWidth);
            }
          };

          ctx.strokeText = function(text, x, y, maxWidth) {
            if (!checkInsideModified(x, y)) {
              originalStrokeText.call(this, text, x, y, maxWidth);
            }
          };
        }

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
          canvas: canvas
        };

        await page.render(renderContext).promise;
        
        // Restore context methods
        ctx.fillText = originalFillText;
        ctx.strokeText = originalStrokeText;
        
        ctx.restore();

        // Extract text content and pre-sample colors ONLY when in edit mode (speeds up scrolling/loading by 100x)
        const isEditMode = isEditingAll || activeTab === 'editar';
        if (!isEditMode) {
          setTextItems([]);
          return;
        }

        try {
          const content = await page.getTextContent();
          const viewport1 = page.getViewport({ scale: 1, rotation });
          
          const offscreenCanvas = document.createElement('canvas');
          offscreenCanvas.width = viewport1.width;
          offscreenCanvas.height = viewport1.height;
          const offscreenCtx = offscreenCanvas.getContext('2d');
          
          if (offscreenCtx) {
            const renderContext = {
              canvasContext: offscreenCtx,
              viewport: viewport1
            };
            await page.render(renderContext).promise;

            // Capture the entire offscreen canvas image data once in RAM
            const offscreenImageData = offscreenCtx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
            
            const items = (content.items || []).map((item: any) => {
              const tx = item.transform[4];
              const ty = item.transform[5];
              const [vx, vy] = viewport1.convertToViewportPoint(tx, ty);
              
              const scaleY = Math.sqrt(item.transform[2] * item.transform[2] + item.transform[3] * item.transform[3]);
              const itemH = Math.max(scaleY || item.height || 12, 8);
              const itemW = Math.max(item.width || 50, 10);
              
              const x = vx;
              const y = vy - itemH;
              
              // Sample colors using the optimized memory-based image data function (takes 0ms)
              const colors = getColorsFromFullImageData(offscreenImageData, x, y, itemW, itemH);
              
              return {
                ...item,
                vx: x,
                vy: y,
                vw: itemW,
                vh: itemH,
                textColor: colors.textColor,
                bgColor: colors.bgColor
              };
            });
            setTextItems(items);
          } else {
            // Fallback if offscreen context creation fails
            const items = (content.items || []).map((item: any) => {
              const tx = item.transform[4];
              const ty = item.transform[5];
              const [vx, vy] = viewport1.convertToViewportPoint(tx, ty);
              const scaleY = Math.sqrt(item.transform[2] * item.transform[2] + item.transform[3] * item.transform[3]);
              const itemH = Math.max(scaleY || item.height || 12, 8);
              const itemW = Math.max(item.width || 50, 10);
              return {
                ...item,
                vx: vx,
                vy: vy - itemH,
                vw: itemW,
                vh: itemH,
                textColor: '#000000',
                bgColor: '#ffffff'
              };
            });
            setTextItems(items);
          }
        } catch (err) {
          console.error("Error rendering offscreen page or extracting text:", err);
          setTextItems([]);
        }
      } catch (err) {
        console.error('Error rendering page:', err);
      } finally {
        setIsRendering(false);
      }
    };

    renderPage();
  }, [pdfDoc, selectedPage, pageOrder, pageMods, zoom, originalPageIndex, isEditingAll, editingAnnId, canvasTrigger, activeTab]);

  // Clear drawing canvas when dimensions change
  useEffect(() => {
    const drawCanvas = drawingCanvasRef.current;
    if (drawCanvas && pageDimensions.width > 0) {
      drawCanvas.width = pageDimensions.width;
      drawCanvas.height = pageDimensions.height;
      const ctx = drawCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    }
  }, [pageDimensions]);

  // Convert client clicks to unscaled coordinates
  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scale = zoom / 100;
    
    // Relative coordinates inside the page canvas element
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Divide by scale so the saved coordinate is unscaled (at 100% zoom)
    return {
      x: x / scale,
      y: y / scale
    };
  };

  // Mouse Handlers for Drawing and Shapes
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!pdfFile || isRendering) return;

    const coords = getCoordinates(e);

    // SELECT TOOL: Click canvas background to deselect
    if (activeTool === 'select') {
      setSelectedAnnId(null);
      setEditingAnnId(null);
      return;
    }

    // TEXT TOOL: Spawn input box
    if (activeTool === 'text') {
      setActiveTextInput(coords);
      setTextInputValue('');
      return;
    }

    // SIGNATURE TOOL: Click to place signature
    if (activeTool === 'signature') {
      if (!selectedSignature) {
        alert('Por favor, selecciona o dibuja una firma en el panel izquierdo primero.');
        return;
      }
      
      // Removed unused scale
      const w = 120; // Default signature width
      const h = 50;  // Default signature height
      
      addAnnotation(originalPageIndex, {
        id: generateUUID(),
        type: 'signature',
        x: coords.x - (w / 2),
        y: coords.y - (h / 2),
        w: w,
        h: h,
        imageBase64: selectedSignature
      });
      
      setActiveTool('hand'); // Reset to hand tool
      return;
    }

    // DRAWING TOOL
    if (activeTool === 'drawing') {
      setIsDrawing(true);
      setDrawingPoints([coords]);
      
      const canvas = drawingCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const scale = zoom / 100;
      ctx.beginPath();
      ctx.moveTo(coords.x * scale, coords.y * scale);
      ctx.lineWidth = drawWidth;
      ctx.strokeStyle = drawColor;
      ctx.lineCap = 'round';
    }

    // REDACT TOOL
    if (activeTool === 'redact') {
      setIsDrawing(true);
      setShapeStart(coords);
      setTempShape({ x: coords.x, y: coords.y, w: 0, h: 0 });
    }

    // SHAPES TOOLS
    if (activeTool.startsWith('shape-')) {
      setIsDrawing(true);
      setShapeStart(coords);
      setTempShape({ x: coords.x, y: coords.y, w: 0, h: 0 });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !pdfFile) return;

    const coords = getCoordinates(e);
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const scale = zoom / 100;

    // DRAWING TOOL
    if (activeTool === 'drawing') {
      setDrawingPoints(prev => [...prev, coords]);
      ctx.lineTo(coords.x * scale, coords.y * scale);
      ctx.stroke();
    }

    // SHAPE TOOLS
    if (activeTool.startsWith('shape-') && shapeStart) {
      const w = coords.x - shapeStart.x;
      const h = coords.y - shapeStart.y;
      
      setTempShape({
        x: w < 0 ? coords.x : shapeStart.x,
        y: h < 0 ? coords.y : shapeStart.y,
        w: Math.abs(w),
        h: Math.abs(h)
      });
      
      // Draw temporary shape on drawing canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = drawWidth;
      ctx.strokeStyle = drawColor;
      
      const sx = (w < 0 ? coords.x : shapeStart.x) * scale;
      const sy = (h < 0 ? coords.y : shapeStart.y) * scale;
      const sw = Math.abs(w) * scale;
      const sh = Math.abs(h) * scale;

      if (activeTool === 'shape-rect') {
        ctx.strokeRect(sx, sy, sw, sh);
      } else if (activeTool === 'shape-circle') {
        ctx.beginPath();
        ctx.ellipse(sx + sw / 2, sy + sh / 2, sw / 2, sh / 2, 0, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (activeTool === 'shape-line') {
        ctx.beginPath();
        ctx.moveTo(shapeStart.x * scale, shapeStart.y * scale);
        ctx.lineTo(coords.x * scale, coords.y * scale);
        ctx.stroke();
      }
    }

    // REDACT TOOL: Draw black rectangle preview
    if (activeTool === 'redact' && shapeStart) {
      const w = coords.x - shapeStart.x;
      const h = coords.y - shapeStart.y;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      const sx = (w < 0 ? coords.x : shapeStart.x) * scale;
      const sy = (h < 0 ? coords.y : shapeStart.y) * scale;
      ctx.fillRect(sx, sy, Math.abs(w) * scale, Math.abs(h) * scale);
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing || !pdfFile) return;
    setIsDrawing(false);

    // Removed unused scale
    
    // DRAWING TOOL
    if (activeTool === 'drawing' && drawingPoints.length > 1) {
      addAnnotation(originalPageIndex, {
        id: generateUUID(),
        type: 'drawing',
        points: drawingPoints,
        color: drawColor,
        width: drawWidth
      });
    }

    // REDACT TOOL
    if (activeTool === 'redact' && shapeStart && tempShape) {
      addAnnotation(originalPageIndex, {
        id: generateUUID(),
        type: 'redact',
        x: tempShape.x,
        y: tempShape.y,
        w: tempShape.w || 1,
        h: tempShape.h || 1,
      });
    }

    // SHAPE TOOLS
    if (activeTool.startsWith('shape-') && shapeStart && tempShape) {
      const shapeType = activeTool.replace('shape-', '') as 'rect' | 'circle' | 'line';
      // For line shape, w and h can be negative
      const w = tempShape.w === 0 ? 1 : tempShape.w;
      const h = tempShape.h === 0 ? 1 : tempShape.h;
      
      addAnnotation(originalPageIndex, {
        id: generateUUID(),
        type: 'shape',
        shapeType: shapeType,
        x: tempShape.x,
        y: tempShape.y,
        w: w,
        h: h,
        strokeColor: drawColor,
        strokeWidth: drawWidth
      });
    }

    // Clear drawing canvas overlay
    const canvas = drawingCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    setShapeStart(null);
    setTempShape(null);
    setDrawingPoints([]);
  };

  // Submit Text Annotation
  const submitTextAnnotation = () => {
    if (!activeTextInput || textInputValue.trim() === '') {
      setActiveTextInput(null);
      return;
    }

    addAnnotation(originalPageIndex, {
      id: generateUUID(),
      type: 'text',
      x: activeTextInput.x,
      y: activeTextInput.y,
      text: textInputValue,
      fontSize: fontSize,
      color: drawColor
    });

    setActiveTextInput(null);
    setTextInputValue('');
  };

  const [isConvertingAll, setIsConvertingAll] = useState(false);

  const handleConvertAllText = async () => {
    if (!pdfDoc || !pdfFile || textItems.length === 0 || isConvertingAll) return;
    setIsConvertingAll(true);

    try {
      const pageNum = originalPageIndex + 1;
      const page = await pdfDoc.getPage(pageNum);

      // --- PARAGRAPH GROUPING ALGORITHM ---
      
      // 1. Filter out empty items and sort by y-coordinate (top-to-bottom), then x-coordinate (left-to-right)
      const sortedItems = [...textItems]
        .filter(item => item.str && item.str.trim() !== '')
        .sort((a, b) => {
          if (Math.abs(a.vy - b.vy) < 5) {
            return a.vx - b.vx;
          }
          return a.vy - b.vy;
        });

      // 2. Horizontal Merge: Combine adjacent chunks on the same line (e.g. spaces or fragmented words)
      const lines: typeof textItems = [];
      sortedItems.forEach(item => {
        if (lines.length === 0) {
          lines.push({ ...item });
          return;
        }
        const lastLine = lines[lines.length - 1];
        const sameLine = Math.abs(item.vy - lastLine.vy) < lastLine.vh * 0.4;
        const dist = item.vx - (lastLine.vx + lastLine.vw);
        const closeHorizontal = dist < lastLine.vh * 1.5;

        if (sameLine && closeHorizontal) {
          const newVx = Math.min(lastLine.vx, item.vx);
          const newVy = Math.min(lastLine.vy, item.vy);
          const newVw = Math.max(lastLine.vx + lastLine.vw, item.vx + item.vw) - newVx;
          const newVh = Math.max(lastLine.vh, item.vh);

          const needsSpace = dist > 2 && !lastLine.str.endsWith(' ') && !item.str.startsWith(' ');
          lastLine.str = lastLine.str + (needsSpace ? ' ' : '') + item.str;
          lastLine.vx = newVx;
          lastLine.vy = newVy;
          lastLine.vw = newVw;
          lastLine.vh = newVh;
        } else {
          lines.push({ ...item });
        }
      });

      // 3. Vertical Paragraph Grouping: Combine lines into paragraphs
      const paragraphs: Array<{
        items: typeof textItems;
        x: number;
        y: number;
        w: number;
        h: number;
        str: string;
        fontName: string;
        textColor: string;
        bgColor: string;
      }> = [];

      lines.forEach(line => {
        if (paragraphs.length === 0) {
          paragraphs.push({
            items: [line],
            x: line.vx,
            y: line.vy,
            w: line.vw,
            h: line.vh,
            str: line.str,
            fontName: line.fontName,
            textColor: line.textColor || '#000000',
            bgColor: line.bgColor || '#ffffff'
          });
          return;
        }

        const lastPara = paragraphs[paragraphs.length - 1];
        const lastLineOfPara = lastPara.items[lastPara.items.length - 1];
        const verticalGap = line.vy - (lastLineOfPara.vy + lastLineOfPara.vh);

        const isSameFont = line.fontName === lastPara.fontName;
        const isSameColor = line.textColor === lastPara.textColor;
        const withinVerticalGap = verticalGap >= -5 && verticalGap < lastLineOfPara.vh * 1.2;
        const horizontallyAligned = Math.abs(line.vx - lastPara.x) < 80 || 
                                    Math.abs((line.vx + line.vw) - (lastPara.x + lastPara.w)) < 80;

        if (isSameFont && isSameColor && withinVerticalGap && horizontallyAligned) {
          lastPara.items.push(line);
          lastPara.str += '\n' + line.str;

          const newX = Math.min(lastPara.x, line.vx);
          const newY = Math.min(lastPara.y, line.vy);
          const newW = Math.max(lastPara.x + lastPara.w, line.vx + line.vw) - newX;
          const newH = Math.max(lastPara.y + lastPara.h, line.vy + line.vh) - newY;

          lastPara.x = newX;
          lastPara.y = newY;
          lastPara.w = newW;
          lastPara.h = newH;
        } else {
          paragraphs.push({
            items: [line],
            x: line.vx,
            y: line.vy,
            w: line.vw,
            h: line.vh,
            str: line.str,
            fontName: line.fontName,
            textColor: line.textColor || '#000000',
            bgColor: line.bgColor || '#ffffff'
          });
        }
      });

      // 4. Create annotations for each paragraph
      for (let i = 0; i < paragraphs.length; i++) {
        const para = paragraphs[i];
        if (!para.str || para.str.trim() === '') continue;

        const rawFontName = getRealFontName(page, para.fontName);
        const originalFontName = rawFontName.toLowerCase();
        
        let detectedFontFamily = 'Helvetica';
        if (originalFontName.includes('courier')) {
          detectedFontFamily = 'Courier';
        } else if (originalFontName.includes('times') || originalFontName.includes('serif') || originalFontName.includes('roman') || originalFontName.includes('georgia') || originalFontName.includes('lora') || originalFontName.includes('merriweather')) {
          detectedFontFamily = 'Times';
        } else if (originalFontName.includes('roboto')) {
          detectedFontFamily = 'Roboto';
        } else if (originalFontName.includes('montserrat')) {
          detectedFontFamily = 'Montserrat';
        } else if (originalFontName.includes('open sans') || originalFontName.includes('opensans')) {
          detectedFontFamily = 'Open Sans';
        } else if (originalFontName.includes('lato')) {
          detectedFontFamily = 'Lato';
        } else if (originalFontName.includes('oswald')) {
          detectedFontFamily = 'Oswald';
        } else if (originalFontName.includes('source sans') || originalFontName.includes('sourcesans')) {
          detectedFontFamily = 'Source Sans Pro';
        } else if (originalFontName.includes('nunito')) {
          detectedFontFamily = 'Nunito';
        } else if (originalFontName.includes('raleway')) {
          detectedFontFamily = 'Raleway';
        } else if (originalFontName.includes('inter')) {
          detectedFontFamily = 'Inter';
        } else if (originalFontName.includes('outfit')) {
          detectedFontFamily = 'Outfit';
        } else if (originalFontName.includes('poppins')) {
          detectedFontFamily = 'Poppins';
        } else if (originalFontName.includes('playfair')) {
          detectedFontFamily = 'Playfair Display';
        } else if (originalFontName.includes('pacifico')) {
          detectedFontFamily = 'Pacifico';
        } else if (originalFontName.includes('lobster')) {
          detectedFontFamily = 'Lobster';
        }

        const isBold = originalFontName.includes('bold') || originalFontName.includes('bd') || originalFontName.includes('black') || originalFontName.includes('w700') || originalFontName.includes('w800') || originalFontName.includes('w900');
        const isItalic = originalFontName.includes('italic') || originalFontName.includes('oblique') || originalFontName.includes('obl') || /\bit\b/.test(originalFontName);

        const leadItem = para.items[0];
        const scaleY = Math.sqrt(leadItem.transform[2] * leadItem.transform[2] + leadItem.transform[3] * leadItem.transform[3]);
        let detectedFontSize = Math.round(scaleY) || Math.round(para.h / para.items.length * 0.85);
        if (leadItem.height && leadItem.height > 0 && Math.abs(leadItem.height - scaleY) / scaleY < 0.4) {
          detectedFontSize = Math.round(leadItem.height);
        }

        const originalLines = para.items.map(item => ({
          x: item.vx - 4,
          y: item.vy - 3,
          w: item.vw + 8,
          h: item.vh + 6
        }));

        addAnnotation(originalPageIndex, {
          id: generateUUID(),
          type: 'text',
          x: para.x - 2,
          y: para.y - 2,
          w: para.w + 4,
          h: para.h + 4,
          text: para.str,
          fontSize: detectedFontSize,
          color: para.textColor,
          fontFamily: detectedFontFamily,
          bold: isBold,
          italic: isItalic,
          backgroundColor: para.bgColor,
          originalText: para.str,
          originalTextLines: para.items.map(item => item.str),
          originalLines: originalLines,
          originalX: para.x - 2,
          originalY: para.y - 2,
          originalWidth: para.w + 4,
          originalHeight: para.h + 4,
        } as any);
      }

      setTextItems([]);
    } catch (err: any) {
      console.error("Error in batch text conversion:", err);
      alert("Error al convertir todo el texto de la página: " + err.message);
    } finally {
      setIsConvertingAll(false);
    }
  };
  // Auto-convert page text to editable when isEditingAll is active
  useEffect(() => {
    if (isEditingAll && textItems.length > 0 && !convertedPages[originalPageIndex] && pdfDoc && !isRendering) {
      setConvertedPages(prev => ({ ...prev, [originalPageIndex]: true }));
      handleConvertAllText();
    }
  }, [isEditingAll, textItems, originalPageIndex, convertedPages, pdfDoc, isRendering]);

  const pageAnns = annotations[originalPageIndex] || [];
  const scale = zoom / 100;

  return (
    <div 
      ref={containerRef}
      className="flex-1 bg-slate-200 overflow-auto flex items-start justify-center p-8 select-none relative"
      onMouseDown={() => {
        setSelectedAnnId(null);
        setEditingAnnId(null);
      }}
    >

      {!pdfFile ? (
        <div className="flex flex-col items-center justify-center h-96 text-slate-400 space-y-4">
          <svg className="w-16 h-16 animate-bounce text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <div className="text-center">
            <h3 className="font-semibold text-slate-600 text-sm">Ningún archivo cargado</h3>
            <p className="text-xs text-slate-400 mt-1">Arrastra un documento PDF o haz clic en "Abrir" para comenzar a editar.</p>
          </div>
        </div>
      ) : (
        <div 
          className="relative pdf-page-container bg-white shadow-xl transition-all select-none overflow-visible"
          style={{ 
            width: pageDimensions.width || 'auto', 
            height: pageDimensions.height || 'auto' 
          }}
        >
          {isRendering && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/70">
              <div className="flex flex-col items-center space-y-2">
                <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
                <span className="text-xs text-slate-500 font-medium">Renderizando página...</span>
              </div>
            </div>
          )}

          {/* Main rendered PDF page canvas */}
          <canvas 
            ref={canvasRef} 
            className="absolute top-0 left-0 z-0 pointer-events-none"
            style={{ width: pageDimensions.width || 'auto', height: pageDimensions.height || 'auto' }}
          />

          {/* Canvas overlay for active drawing */}
          <canvas
            ref={drawingCanvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            className={`absolute top-0 left-0 z-10 ${
              activeTool === 'hand' ? 'cursor-grab active:cursor-grabbing' : 
              activeTool === 'select' ? 'cursor-default' : 'cursor-crosshair'
            }`}
            style={{ width: pageDimensions.width || 'auto', height: pageDimensions.height || 'auto' }}
          />

          {/* Alignment guide lines */}
          {alignmentGuides.showVertical && (
            <>
              {/* Left vertical line */}
              <div 
                className="absolute top-0 bottom-0 pointer-events-none z-40 border-l border-solid border-green-500"
                style={{ 
                  left: `${alignmentGuides.x * scale}px`,
                  width: '0px'
                }}
              />
              {/* Right vertical line */}
              <div 
                className="absolute top-0 bottom-0 pointer-events-none z-40 border-l border-solid border-green-500"
                style={{ 
                  left: `${(alignmentGuides.x + alignmentGuides.w) * scale}px`,
                  width: '0px'
                }}
              />
            </>
          )}
          {alignmentGuides.showHorizontal && (
            <>
              {/* Top horizontal line */}
              <div 
                className="absolute left-0 right-0 pointer-events-none z-40 border-t border-solid border-green-500"
                style={{ 
                  top: `${alignmentGuides.y * scale}px`,
                  height: '0px'
                }}
              />
              {/* Bottom horizontal line */}
              <div 
                className="absolute left-0 right-0 pointer-events-none z-40 border-t border-solid border-green-500"
                style={{ 
                  top: `${(alignmentGuides.y + alignmentGuides.h) * scale}px`,
                  height: '0px'
                }}
              />
            </>
          )}

          {/* HTML Annotations Display Layer */}
          <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-20 overflow-visible">

            {pageAnns.map((ann) => {
              const isSelected = selectedAnnId === ann.id;

              if (ann.type === 'text') {
                const isEditMode = isEditingAll || activeTab === 'editar';
                const width = ann.w || 200;
                const height = ann.h || (ann.fontSize * 1.3);

                const originalLinesCount = (ann as any).originalTextLines ? (ann as any).originalTextLines.length : 1;
                const wasResized = (ann as any).originalWidth !== undefined && Math.abs((ann.w || 0) - (ann as any).originalWidth) > 0.5;
                const shouldWrap = ann.text.includes('\n') || originalLinesCount > 1 || wasResized;

                // Render as static text when not in edit mode (Inicio/Seleccionar or other tabs)
                if (!isEditMode) {
                  // If the annotation is unmodified, do NOT render it in HTML to avoid double rendering
                  // (since the canvas already draws it perfectly).
                  if (!shouldWrap && ann.text === ann.originalText && 
                      (ann.originalX === undefined || Math.abs(ann.x - ann.originalX) <= 0.1) &&
                      (ann.originalY === undefined || Math.abs(ann.y - ann.originalY) <= 0.1)) {
                    return null;
                  }

                  return (
                    <div
                      key={ann.id}
                      style={{
                        position: 'absolute',
                        left: `${ann.x * scale}px`,
                        top: `${ann.y * scale}px`,
                        width: `${width * scale}px`,
                        height: `${height * scale}px`,
                        pointerEvents: 'none',
                        zIndex: 20,
                      }}
                    >
                      <div
                        className={`w-full h-full leading-none ${shouldWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
                        style={{
                          fontSize: `${ann.fontSize * scale}px`,
                          color: ann.color,
                          fontFamily: (ann as any).fontFamily === 'Courier' 
                            ? 'Courier New, Courier, monospace' 
                            : (ann as any).fontFamily === 'Times' 
                              ? 'Times New Roman, Times, serif' 
                              : (ann as any).fontFamily === 'Helvetica'
                                ? 'Segoe UI, Helvetica, Arial, sans-serif'
                                : (ann as any).fontFamily || 'Segoe UI, Helvetica, Arial, sans-serif',
                          fontWeight: (ann as any).bold ? 'bold' : 'normal',
                          fontStyle: (ann as any).italic ? 'italic' : 'normal',
                          textDecoration: (ann as any).underline ? 'underline' : 'none',
                          textAlign: (ann as any).align || 'left',
                          lineHeight: 1,
                          background: 'transparent', // Make the text background transparent
                          ...(ann.h ? {
                            paddingTop: shouldWrap ? 0 : `${Math.max(0, ann.h - ann.fontSize - 2) * scale}px`,
                            paddingBottom: `${2 * scale}px`,
                            boxSizing: 'border-box' as const,
                          } : {})
                        }}
                      >
                        {ann.text}
                      </div>
                    </div>
                  );
                }

                return (
                  <Transformable
                    key={ann.id}
                    id={ann.id}
                    x={ann.x}
                    y={ann.y}
                    w={width}
                    h={height}
                    scale={scale}
                    selected={isSelected && activeTool === 'select'}
                    onSelect={() => setSelectedAnnId(ann.id)}
                    onDrag={(dx, dy) => handleAnnotationDrag(ann, dx, dy)}
                    onDragEnd={handleAnnotationDragEnd}
                    onResize={(newX, newY, newW, newH, handle) => handleAnnotationResize(ann, newX, newY, newW, newH, handle)}
                    onResizeEnd={handleAnnotationResizeEnd}
                    borderStyle={activeTool === 'select' ? 'solid-black' : 'none'}
                  >
                    <div
                      className="w-full h-full relative"
                      style={{
                        background: 'transparent', // Make the text background transparent
                      }}
                    >
                      {editingAnnId === ann.id ? (
                        <textarea
                          autoFocus
                          value={editTextValue}
                          onChange={(e) => {
                            setEditTextValue(e.target.value);
                            updateAnnotation(originalPageIndex, ann.id, { text: e.target.value }, true);
                          }}
                          onBlur={() => {
                            setEditingAnnId(null);
                          }}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Escape') {
                              setEditingAnnId(null);
                            }
                          }}
                          className="w-full h-full p-0 m-0 border-0 focus:outline-none bg-transparent resize-none leading-none"
                          style={{
                            fontSize: `${ann.fontSize * scale}px`,
                            color: ann.color,
                            fontFamily: (ann as any).fontFamily === 'Courier' 
                              ? 'Courier New, Courier, monospace' 
                              : (ann as any).fontFamily === 'Times' 
                                ? 'Times New Roman, Times, serif' 
                                : (ann as any).fontFamily === 'Helvetica'
                                  ? 'Segoe UI, Helvetica, Arial, sans-serif'
                                  : (ann as any).fontFamily || 'Segoe UI, Helvetica, Arial, sans-serif',
                            fontWeight: (ann as any).bold ? 'bold' : 'normal',
                            fontStyle: (ann as any).italic ? 'italic' : 'normal',
                            textDecoration: (ann as any).underline ? 'underline' : 'none',
                            textAlign: (ann as any).align || 'left',
                            background: 'transparent',
                            lineHeight: 1,
                            whiteSpace: shouldWrap ? 'pre-wrap' : 'pre',
                            overflow: 'hidden',
                            ...(ann.h ? {
                              paddingTop: shouldWrap ? 0 : `${Math.max(0, ann.h - ann.fontSize - 2) * scale}px`,
                              paddingBottom: `${2 * scale}px`,
                              boxSizing: 'border-box' as const,
                            } : {
                              padding: '2px'
                            })
                          }}
                        />
                      ) : (
                        <div
                          className={`w-full h-full leading-none ${shouldWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
                          style={{
                            fontSize: `${ann.fontSize * scale}px`,
                            color: ann.color,
                            fontFamily: (ann as any).fontFamily === 'Courier' 
                              ? 'Courier New, Courier, monospace' 
                              : (ann as any).fontFamily === 'Times' 
                                ? 'Times New Roman, Times, serif' 
                                : (ann as any).fontFamily === 'Helvetica'
                                  ? 'Segoe UI, Helvetica, Arial, sans-serif'
                                  : (ann as any).fontFamily || 'Segoe UI, Helvetica, Arial, sans-serif',
                            fontWeight: (ann as any).bold ? 'bold' : 'normal',
                            fontStyle: (ann as any).italic ? 'italic' : 'normal',
                            textDecoration: (ann as any).underline ? 'underline' : 'none',
                            textAlign: (ann as any).align || 'left',
                            background: 'transparent',
                            lineHeight: 1,
                            ...(ann.h ? {
                              paddingTop: shouldWrap ? 0 : `${Math.max(0, ann.h - ann.fontSize - 2) * scale}px`,
                              paddingBottom: `${2 * scale}px`,
                              boxSizing: 'border-box' as const,
                            } : {})
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (activeTool === 'select' && (isEditingAll || activeTab === 'editar')) {
                              // Push clean current state to history before starting real-time modifications
                              updateAnnotation(originalPageIndex, ann.id, { text: ann.text }, false);
                              setEditingAnnId(ann.id);
                              setEditTextValue(ann.text);
                            }
                          }}
                        >
                          {ann.text}
                        </div>
                      )}
                    </div>
                  </Transformable>
                );
              }

              if (ann.type === 'shape') {
                const isInteractive = (ann as any).interactive !== false;
                
                const svgContent = (
                  <svg className="w-full h-full overflow-visible pointer-events-none">
                    {ann.shapeType === 'rect' && (
                      <rect 
                        x={0}
                        y={0}
                        width="100%"
                        height="100%"
                        stroke={ann.strokeColor}
                        strokeWidth={ann.strokeWidth}
                        fill={ann.fillColor || "transparent"}
                      />
                    )}
                    {ann.shapeType === 'circle' && (
                      <ellipse 
                        cx="50%"
                        cy="50%"
                        rx="50%"
                        ry="50%"
                        stroke={ann.strokeColor}
                        strokeWidth={ann.strokeWidth}
                        fill={ann.fillColor || "transparent"}
                      />
                    )}
                    {ann.shapeType === 'line' && (
                      <line 
                        x1={0}
                        y1={0}
                        x2="100%"
                        y2="100%"
                        stroke={ann.strokeColor}
                        strokeWidth={ann.strokeWidth}
                      />
                    )}
                  </svg>
                );

                if (!isInteractive) {
                  return (
                    <div
                      key={ann.id}
                      style={{
                        position: 'absolute',
                        left: `${ann.x * scale}px`,
                        top: `${ann.y * scale}px`,
                        width: `${ann.w * scale}px`,
                        height: `${ann.h * scale}px`,
                        pointerEvents: 'none',
                        zIndex: 10,
                      }}
                    >
                      {svgContent}
                    </div>
                  );
                }

                return (
                  <Transformable
                    key={ann.id}
                    id={ann.id}
                    x={ann.x}
                    y={ann.y}
                    w={ann.w}
                    h={ann.h}
                    scale={scale}
                    selected={isSelected && activeTool === 'select'}
                    onSelect={() => setSelectedAnnId(ann.id)}
                    onDrag={(dx, dy) => handleAnnotationDrag(ann, dx, dy)}
                    onDragEnd={handleAnnotationDragEnd}
                    onResize={(newX, newY, newW, newH, handle) => handleAnnotationResize(ann, newX, newY, newW, newH, handle)}
                    onResizeEnd={handleAnnotationResizeEnd}
                  >
                    {svgContent}
                  </Transformable>
                );
              }

              if (ann.type === 'image' || ann.type === 'signature') {
                return (
                  <Transformable
                    key={ann.id}
                    id={ann.id}
                    x={ann.x}
                    y={ann.y}
                    w={ann.w}
                    h={ann.h}
                    scale={scale}
                    selected={isSelected && activeTool === 'select'}
                    lockAspectRatio={true}
                    onSelect={() => setSelectedAnnId(ann.id)}
                    onDrag={(dx, dy) => handleAnnotationDrag(ann, dx, dy)}
                    onDragEnd={handleAnnotationDragEnd}
                    onResize={(newX, newY, newW, newH, handle) => handleAnnotationResize(ann, newX, newY, newW, newH, handle)}
                    onResizeEnd={handleAnnotationResizeEnd}
                  >
                    <img 
                      src={ann.imageBase64} 
                      alt={ann.type} 
                      className="w-full h-full object-contain pointer-events-none select-none" 
                      style={{ opacity: (ann as any).opacity !== undefined ? (ann as any).opacity : 1 }}
                    />
                  </Transformable>
                );
              }

              if (ann.type === 'redact') {
                return (
                  <Transformable
                    key={ann.id}
                    id={ann.id}
                    x={ann.x}
                    y={ann.y}
                    w={ann.w}
                    h={ann.h}
                    scale={scale}
                    selected={isSelected && activeTool === 'select'}
                    onSelect={() => setSelectedAnnId(ann.id)}
                    onDrag={(dx, dy) => handleAnnotationDrag(ann, dx, dy)}
                    onDragEnd={handleAnnotationDragEnd}
                    onResize={(newX, newY, newW, newH, handle) => handleAnnotationResize(ann, newX, newY, newW, newH, handle)}
                    onResizeEnd={handleAnnotationResizeEnd}
                  >
                    <div className="w-full h-full bg-black border border-red-600 pointer-events-none" />
                  </Transformable>
                );
              }

              if (ann.type === 'drawing') {
                const box = getDrawingBoundingBox(ann.points);
                return (
                  <Transformable
                    key={ann.id}
                    id={ann.id}
                    x={box.x}
                    y={box.y}
                    w={box.w}
                    h={box.h}
                    scale={scale}
                    selected={isSelected && activeTool === 'select'}
                    onSelect={() => setSelectedAnnId(ann.id)}
                    onDrag={(dx, dy) => handleAnnotationDrag(ann, dx, dy)}
                    onDragEnd={handleAnnotationDragEnd}
                    onResize={(newX, newY, newW, newH, handle) => handleAnnotationResize(ann, newX, newY, newW, newH, handle)}
                    onResizeEnd={handleAnnotationResizeEnd}
                  >
                    <svg className="w-full h-full overflow-visible pointer-events-none">
                      <path 
                        d={`M ${ann.points.map(p => `${(p.x - box.x) * scale} ${(p.y - box.y) * scale}`).join(' L ')}`}
                        fill="none"
                        stroke={ann.color}
                        strokeWidth={ann.width * scale}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </Transformable>
                );
              }

              return null;
            })}

            {/* Editable Text Layer - shows when Select tool is active and we are in Edit mode */}
            {activeTool === 'select' && (isEditingAll || activeTab === 'editar') && textItems.map((item, idx) => {
              if (!item.str || item.str.trim() === '') return null;
              
              // Skip rendering the hover box if this text item has already been converted to an annotation
              const isAlreadyConverted = pageAnns.some(ann => 
                ann.type === 'text' && 
                (ann as any).originalX !== undefined &&
                Math.abs((ann as any).originalX - (item.vx - 2)) < 1.5 &&
                Math.abs((ann as any).originalY - (item.vy - 2)) < 1.5
              );
              if (isAlreadyConverted) return null;
              
              const x = item.vx;
              const y = item.vy;
              const itemW = item.vw;
              const itemH = item.vh;
              
              const isConverting = convertingTextIndex === idx;

              return (
                <div
                  key={idx}
                  style={{
                    position: 'absolute',
                    left: `${x * scale}px`,
                    top: `${y * scale}px`,
                    width: `${itemW * scale}px`,
                    height: `${itemH * scale}px`,
                    pointerEvents: 'auto',
                    zIndex: 25,
                  }}
                  className={`group rounded border border-dashed border-transparent hover:border-brand-500 hover:bg-brand-500/10 cursor-pointer transition-all duration-100 flex items-center justify-center`}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (isConverting) return;
                    
                    setConvertingTextIndex(idx);

                    try {
                      if (pdfDoc) {
                        const newId = generateUUID();
                        
                        const page = await pdfDoc.getPage(originalPageIndex + 1);
                        // Extract colors from pre-sampled values
                        const textColor = item.textColor || '#000000';
                        const bgColor = item.bgColor || '#ffffff';

                        // Retrieve real font name from page resources
                        const rawFontName = getRealFontName(page, item.fontName);
                        const originalFontName = rawFontName.toLowerCase();
                        
                        let detectedFontFamily = 'Helvetica';
                        if (originalFontName.includes('courier')) {
                          detectedFontFamily = 'Courier';
                        } else if (originalFontName.includes('times') || originalFontName.includes('serif') || originalFontName.includes('roman') || originalFontName.includes('georgia') || originalFontName.includes('lora') || originalFontName.includes('merriweather')) {
                          detectedFontFamily = 'Times';
                        } else if (originalFontName.includes('roboto')) {
                          detectedFontFamily = 'Roboto';
                        } else if (originalFontName.includes('montserrat')) {
                          detectedFontFamily = 'Montserrat';
                        } else if (originalFontName.includes('open sans') || originalFontName.includes('opensans')) {
                          detectedFontFamily = 'Open Sans';
                        } else if (originalFontName.includes('lato')) {
                          detectedFontFamily = 'Lato';
                        } else if (originalFontName.includes('oswald')) {
                          detectedFontFamily = 'Oswald';
                        } else if (originalFontName.includes('source sans') || originalFontName.includes('sourcesans')) {
                          detectedFontFamily = 'Source Sans Pro';
                        } else if (originalFontName.includes('nunito')) {
                          detectedFontFamily = 'Nunito';
                        } else if (originalFontName.includes('raleway')) {
                          detectedFontFamily = 'Raleway';
                        } else if (originalFontName.includes('inter')) {
                          detectedFontFamily = 'Inter';
                        } else if (originalFontName.includes('outfit')) {
                          detectedFontFamily = 'Outfit';
                        } else if (originalFontName.includes('poppins')) {
                          detectedFontFamily = 'Poppins';
                        } else if (originalFontName.includes('playfair')) {
                          detectedFontFamily = 'Playfair Display';
                        } else if (originalFontName.includes('pacifico')) {
                          detectedFontFamily = 'Pacifico';
                        } else if (originalFontName.includes('lobster')) {
                          detectedFontFamily = 'Lobster';
                        }

                        const isBold = originalFontName.includes('bold') || originalFontName.includes('bd') || originalFontName.includes('black') || originalFontName.includes('w700') || originalFontName.includes('w800') || originalFontName.includes('w900');
                        const isItalic = originalFontName.includes('italic') || originalFontName.includes('oblique') || originalFontName.includes('obl') || /\bit\b/.test(originalFontName);
                        
                        const scaleY = Math.sqrt(item.transform[2] * item.transform[2] + item.transform[3] * item.transform[3]);
                        let detectedFontSize = Math.round(scaleY) || Math.round(itemH * 0.85);
                        if (item.height && item.height > 0 && Math.abs(item.height - scaleY) / scaleY < 0.4) {
                          detectedFontSize = Math.round(item.height);
                        }

                        const originalLines = [{
                          x: x - 4,
                          y: y - 3,
                          w: itemW + 8,
                          h: itemH + 6
                        }];

                        // Add editable text annotation (slightly larger, bg matches canvas to hide original text)
                        addAnnotation(originalPageIndex, {
                          id: newId,
                           type: 'text',
                           x: x - 2,
                           y: y - 2,
                           w: itemW + 4,
                           h: itemH + 4,
                           text: item.str,
                           fontSize: detectedFontSize,
                           color: textColor,
                           fontFamily: detectedFontFamily,
                           bold: isBold,
                           italic: isItalic,
                           backgroundColor: bgColor,
                           originalText: item.str,
                           originalTextLines: [item.str],
                           originalLines: originalLines,
                           originalX: x - 2,
                           originalY: y - 2,
                           originalWidth: itemW + 4,
                           originalHeight: itemH + 4,
                        } as any);
                        
                        // Push created state to history so typing edits can be undone back to creation state
                        updateAnnotation(originalPageIndex, newId, { text: item.str }, false);
                        
                        setSelectedAnnId(newId);
                        setEditingAnnId(newId);
                        setEditTextValue(item.str);
                      }
                    } catch (err: any) {
                      console.error('Error converting text:', err);
                      alert('Error al convertir texto: ' + err.message);
                    } finally {
                      setConvertingTextIndex(null);
                    }
                  }}
                >
                  {isConverting ? (
                    <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
                      <Loader2 className="w-3.5 h-3.5 text-brand-500 animate-spin" />
                    </div>
                  ) : (
                    <>
                      <span className="block w-full h-full text-transparent select-none" />
                      <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 bg-slate-900 text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity font-sans pointer-events-none shadow z-30 whitespace-nowrap">
                        Editar en lugar (Acrobat-style)
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {/* Active typing Textbox overlay */}
            {activeTextInput && (
              <div 
                style={{ 
                  position: 'absolute',
                  left: `${activeTextInput.x * scale}px`, 
                  top: `${activeTextInput.y * scale}px`,
                  pointerEvents: 'auto',
                  zIndex: 100
                }}
                className="bg-white border border-brand-500 rounded p-1 shadow-md flex items-center space-x-1.5 min-w-[180px]"
              >
                <input 
                  type="text" 
                  autoFocus
                  placeholder="Escribe texto..."
                  value={textInputValue}
                  onChange={(e) => setTextInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitTextAnnotation();
                    if (e.key === 'Escape') setActiveTextInput(null);
                  }}
                  className="flex-1 px-1.5 py-0.5 text-xs text-slate-800 focus:outline-none border-b border-slate-200"
                />
                <button 
                  onClick={submitTextAnnotation}
                  className="p-0.5 bg-green-100 hover:bg-green-200 text-green-700 rounded"
                  title="Aceptar"
                >
                  <Check size={12} />
                </button>
                <button 
                  onClick={() => setActiveTextInput(null)}
                  className="p-0.5 bg-red-100 hover:bg-red-200 text-red-700 rounded"
                  title="Cancelar"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
