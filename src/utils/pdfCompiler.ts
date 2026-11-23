import { PDFDocument, rgb, degrees, StandardFonts, PDFName } from 'pdf-lib';

// Internal pdf-lib classes for content stream manipulation (fallback)
import PDFRef from 'pdf-lib/es/core/objects/PDFRef';
import PDFOperator from 'pdf-lib/es/core/operators/PDFOperator';
import PDFString from 'pdf-lib/es/core/objects/PDFString';
import PDFHexString from 'pdf-lib/es/core/objects/PDFHexString';

// MuPDF WASM (loaded lazily)
let muPDFInstance: any = null;
async function getMuPDF(): Promise<any> {
  if (!muPDFInstance) {
    const mod = await import('mupdf');
    muPDFInstance = mod.default;
  }
  return muPDFInstance;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface TextAnnotation {
  id: string;
  type: 'text';
  x: number;
  y: number;
  w?: number;
  h?: number;
  text: string;
  fontSize: number;
  color: string; // Hex e.g., '#ff0000'
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  backgroundColor?: string;
  originalText?: string;
  originalX?: number;
  originalY?: number;
  originalWidth?: number;
  originalHeight?: number;
}

export interface DrawingAnnotation {
  id: string;
  type: 'drawing';
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
}

export interface ShapeAnnotation {
  id: string;
  type: 'shape';
  shapeType: 'rect' | 'circle' | 'line';
  x: number;
  y: number;
  w: number;
  h: number;
  strokeColor: string;
  fillColor?: string;
  strokeWidth: number;
  interactive?: boolean;
}

export interface SignatureAnnotation {
  id: string;
  type: 'signature';
  x: number;
  y: number;
  w: number;
  h: number;
  imageBase64: string; // PNG format base64 string
  opacity?: number;
}

export interface ImageAnnotation {
  id: string;
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  imageBase64: string;
  opacity?: number;
}

export interface RedactAnnotation {
  id: string;
  type: 'redact';
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Annotation = TextAnnotation | DrawingAnnotation | ShapeAnnotation | SignatureAnnotation | ImageAnnotation | RedactAnnotation;

export interface PageModification {
  deleted: boolean;
  rotation: number; // 0, 90, 180, 270
}

export interface WatermarkSettings {
  text: string;
  color: string;
  fontSize: number;
  opacity: number;
  angle: number;
}

export interface SecuritySettings {
  userPassword?: string;
  ownerPassword?: string;
}

// Convert Hex Color to RGB decimals (0 to 1)
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map(c => c + c).join('');
  }
  const num = parseInt(cleanHex, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

// Convert Base64 string to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  // Strip mime type if present
  const base64Clean = base64.includes(',') ? base64.split(',')[1] : base64;
  const binaryString = atob(base64Clean);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

const fontCache: Record<string, Uint8Array> = {};

const GOOGLE_FONTS_URLS: Record<string, { regular: string; bold?: string; italic?: string; boldItalic?: string }> = {
  Roboto: {
    regular: 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.ttf',
    bold: 'https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlfBBc4.ttf',
    italic: 'https://fonts.gstatic.com/s/roboto/v30/KFOkCnqEu92Fr1Mu51xIIzc.ttf',
    boldItalic: 'https://fonts.gstatic.com/s/roboto/v30/KFOjCnqEu92Fr1Mu51TzBhc9.ttf',
  },
  Montserrat: {
    regular: 'https://fonts.gstatic.com/s/montserrat/v25/JTUHjIg1_i6t8kCHKm4MV96gxpxq.ttf',
    bold: 'https://fonts.gstatic.com/s/montserrat/v25/JTURjIg1_i6t8kCHKm4MV_d7z4njVNEc.ttf',
    italic: 'https://fonts.gstatic.com/s/montserrat/v25/JTUJjIg1_i6t8kCHKm4MV96xfpxq.ttf',
    boldItalic: 'https://fonts.gstatic.com/s/montserrat/v25/JTUXjIg1_i6t8kCHKm4MV_d7emdo.ttf',
  },
  'Playfair Display': {
    regular: 'https://fonts.gstatic.com/s/playfairdisplay/v30/nuFvD7K3aUeUx0G7yniYxb27_FD3tuIudYY0Dg.ttf',
    bold: 'https://fonts.gstatic.com/s/playfairdisplay/v30/nuFlD7K3aUeUx0G7yniYxb27_FD3tuIudY2rDg5KbF4.ttf',
    italic: 'https://fonts.gstatic.com/s/playfairdisplay/v30/nuFrD7K3aUeUx0G7yniYxb27_FD3tuIudY3jwk68ag.ttf',
    boldItalic: 'https://fonts.gstatic.com/s/playfairdisplay/v30/nuFpD7K3aUeUx0G7yniYxb27_FD3tuIudYY8imufak8cag.ttf',
  },
  Pacifico: {
    regular: 'https://fonts.gstatic.com/s/pacifico/v22/F1zEdnHzM2q3iWOk77Cq6Hs.ttf',
  },
  Lobster: {
    regular: 'https://fonts.gstatic.com/s/lobster/v30/ne3DHAwts0GrC97EBqY0.ttf',
  },
  'Open Sans': {
    regular: 'https://fonts.gstatic.com/s/opensans/v40/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsg-1x4uaViq.ttf',
    bold: 'https://fonts.gstatic.com/s/opensans/v40/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsg-1x4utWiq.ttf',
    italic: 'https://fonts.gstatic.com/s/opensans/v40/memQYaGs126MiZpBA-UFUIcVXSCEkx2cmqvXlWq8tWZ0Pw86iFg88k65XCs.ttf',
    boldItalic: 'https://fonts.gstatic.com/s/opensans/v40/memdYaGs126MiZpBA-UFUIcVXSCEkx2cmqvXlWq8yYwM-n86iFg88k65XCtY.ttf',
  },
  Lato: {
    regular: 'https://fonts.gstatic.com/s/lato/v24/S6uyw4BMUTPHjxAwXg.ttf',
    bold: 'https://fonts.gstatic.com/s/lato/v24/S6u9w4BMUTPHh6Uvws73Xg.ttf',
    italic: 'https://fonts.gstatic.com/s/lato/v24/S6u8w4BMUTPHjxswWPcW.ttf',
    boldItalic: 'https://fonts.gstatic.com/s/lato/v24/S6u5w4BMUTPHjxsdHHr72qE.ttf',
  },
  Oswald: {
    regular: 'https://fonts.gstatic.com/s/oswald/v49/TK3iWgpNpD3DQyXVbHw.ttf',
    bold: 'https://fonts.gstatic.com/s/oswald/v49/TK3hWgpNpD3DQyXVfN2GFw.ttf',
  },
  'Source Sans Pro': {
    regular: 'https://fonts.gstatic.com/s/sourcesanspro/v22/6xK3dSBYKcSV-LCoeQqfX1RYOo3qOK7lujVj9w.ttf',
    bold: 'https://fonts.gstatic.com/s/sourcesanspro/v22/6xKydSBYKcSV-LCoeQqfX1RYOo3i54rAkA.ttf',
    italic: 'https://fonts.gstatic.com/s/sourcesanspro/v22/6xK1dSBYKcSV-LCoeQqfX1RYOo3qPZ7nsDJB.ttf',
    boldItalic: 'https://fonts.gstatic.com/s/sourcesanspro/v22/6xK0dSBYKcSV-LCoeQqfX1RYOo3iL471vDJB9w.ttf',
  },
  Lora: {
    regular: 'https://fonts.gstatic.com/s/lora/v32/0QI6MX1D_JOuGQbT0gvF.ttf',
    bold: 'https://fonts.gstatic.com/s/lora/v32/0QI8MX1D_JOuMw3ekN_v-w.ttf',
    italic: 'https://fonts.gstatic.com/s/lora/v32/0QI7MX1D_JOuMw_7LdfGxA.ttf',
    boldItalic: 'https://fonts.gstatic.com/s/lora/v32/0QIAMX1D_JOuMw_t7dft8q9S.ttf',
  },
  Merriweather: {
    regular: 'https://fonts.gstatic.com/s/merriweather/v30/u-440qy4sR3g3vKjZ-M62XQ.ttf',
    bold: 'https://fonts.gstatic.com/s/merriweather/v30/u-470qy4sR3g3vKjZ-M62XLocw.ttf',
    italic: 'https://fonts.gstatic.com/s/merriweather/v30/u-460qy4sR3g3vKjZ-M62XQiwg.ttf',
    boldItalic: 'https://fonts.gstatic.com/s/merriweather/v30/u-450qy4sR3g3vKjZ-M62XQlqpvM.ttf',
  },
  Nunito: {
    regular: 'https://fonts.gstatic.com/s/nunito/v26/XRXX3I6Li01BKofIMN5M.ttf',
    bold: 'https://fonts.gstatic.com/s/nunito/v26/XRXW3I6Li01BKofAjsOUbQ.ttf',
    italic: 'https://fonts.gstatic.com/s/nunito/v26/XRXV3I6Li01BKofIOOaBTMk.ttf',
    boldItalic: 'https://fonts.gstatic.com/s/nunito/v26/XRXQ3I6Li01BKofIMN5MZsg_.ttf',
  },
  Raleway: {
    regular: 'https://fonts.gstatic.com/s/raleway/v28/1Ptxg8zYS_SKggPNyCgwQ.ttf',
    bold: 'https://fonts.gstatic.com/s/raleway/v28/1Ptqg8zYS_SKggPNyDgwsoY.ttf',
    italic: 'https://fonts.gstatic.com/s/raleway/v28/1Ptzg8zYS_SKggPNyCg4oQ.ttf',
    boldItalic: 'https://fonts.gstatic.com/s/raleway/v28/1Ptqg8zYS_SKggPNyCgwsoY.ttf',
  },
  Inter: {
    regular: 'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfMZhrib2bgA.ttf',
    bold: 'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuIedfZhrib2bgA.ttf',
  },
  Outfit: {
    regular: 'https://fonts.gstatic.com/s/outfit/v11/Fons38I-z6sX2r7GQG.ttf',
    bold: 'https://fonts.gstatic.com/s/outfit/v11/Fons38I-z6sX2r7GgG4.ttf',
  },
  Poppins: {
    regular: 'https://fonts.gstatic.com/s/poppins/v20/pxiEyp8kv8JHgFVrFJg.ttf',
    bold: 'https://fonts.gstatic.com/s/poppins/v20/pxiByp8kv8JHgFVrGLEx.ttf',
    italic: 'https://fonts.gstatic.com/s/poppins/v20/pxiGyp8kv8JHgFVrJJLucw.ttf',
    boldItalic: 'https://fonts.gstatic.com/s/poppins/v20/pxiCyp8kv8JHgFVrJJLmv1ur.ttf',
  }
};

async function fetchFont(url: string): Promise<Uint8Array> {
  if (fontCache[url]) return fontCache[url];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch font at ${url}`);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  fontCache[url] = bytes;
  return bytes;
}

function wrapText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
  const paragraphs = text.split('\n');
  const result: string[] = [];

  for (const para of paragraphs) {
    const words = para.split(' ');
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);
      if (width > maxWidth && currentLine) {
        result.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      result.push(currentLine);
    }
  }
  return result;
}

export async function compilePdf(
  originalPdfBytes: Uint8Array,
  pageOrder: number[], // Array of original page indices, e.g. [0, 1, 2]
  pageMods: Record<number, PageModification>, // originalPageIndex -> mods
  annotations: Record<number, Annotation[]>, // originalPageIndex -> annotations
  watermark: WatermarkSettings | null,
  security: SecuritySettings | null,
  bookmarks?: Array<{ title: string; pageIndex: number }>
): Promise<Uint8Array> {
  // 3. Filter page order: remove deleted pages first to know which pages we need to modify
  const validPageIndices: number[] = [];
  pageOrder.forEach((origIdx) => {
    const mods = pageMods[origIdx];
    if (!mods || !mods.deleted) {
      validPageIndices.push(origIdx);
    }
  });

  if (validPageIndices.length === 0) {
    throw new Error('No puedes guardar un PDF sin páginas.');
  }

  // Pre-process PDF bytes to replace original text with spaces for modified/moved text annotations
  let pdfBytesToLoad = originalPdfBytes;
  try {
    for (const origIdx of validPageIndices) {
      const pageAnns = annotations[origIdx] || [];
      const replacements: Array<{ oldText: string; newText: string }> = [];
      
      for (const ann of pageAnns) {
        if (ann.type === 'text') {
          // Check if this text annotation has actually been modified or moved
          const isModified = ann.originalText === undefined || 
                             ann.text !== ann.originalText ||
                             (ann.originalX !== undefined && Math.abs(ann.x - ann.originalX) > 0.1) ||
                             (ann.originalY !== undefined && Math.abs(ann.y - ann.originalY) > 0.1);
                             
          if (!isModified) {
            continue; // Skip replacements for unmodified text
          }

          if ((ann as any).originalTextLines) {
            (ann as any).originalTextLines.forEach((lineText: string) => {
              if (lineText && lineText.trim() !== '') {
                const spaces = "".padStart(lineText.length, " ");
                replacements.push({
                  oldText: lineText,
                  newText: spaces
                });
              }
            });
          } else if (ann.originalText) {
            const spaces = "".padStart(ann.originalText.length, " ");
            replacements.push({
              oldText: ann.originalText,
              newText: spaces
            });
          }
        }
      }
      
      if (replacements.length > 0) {
        for (const rep of replacements) {
          const updatedBytes = await replacePdfText(pdfBytesToLoad, origIdx, rep.oldText, rep.newText);
          if (updatedBytes) {
            pdfBytesToLoad = updatedBytes;
          }
        }
      }
    }
  } catch (err) {
    console.warn('Error applying content stream text replacements:', err);
  }

  // 1. Load original document (with modified text streams replaced by spaces)
  const srcDoc = await PDFDocument.load(pdfBytesToLoad);
  
  // 2. Create target document
  const destDoc = await PDFDocument.create();
  
  // Embed Helvetica Font variations
  const helveticaFont = await destDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBoldFont = await destDoc.embedFont(StandardFonts.HelveticaBold);
  const helveticaObliqueFont = await destDoc.embedFont(StandardFonts.HelveticaOblique);
  const helveticaBoldObliqueFont = await destDoc.embedFont(StandardFonts.HelveticaBoldOblique);

  // Embed Times Roman Font variations
  const timesFont = await destDoc.embedFont(StandardFonts.TimesRoman);
  const timesBoldFont = await destDoc.embedFont(StandardFonts.TimesRomanBold);
  const timesItalicFont = await destDoc.embedFont(StandardFonts.TimesRomanItalic);
  const timesBoldItalicFont = await destDoc.embedFont(StandardFonts.TimesRomanBoldItalic);

  // Embed Courier Font variations
  const courierFont = await destDoc.embedFont(StandardFonts.Courier);
  const courierBoldFont = await destDoc.embedFont(StandardFonts.CourierBold);
  const courierObliqueFont = await destDoc.embedFont(StandardFonts.CourierOblique);
  const courierBoldObliqueFont = await destDoc.embedFont(StandardFonts.CourierBoldOblique);

  // 4. Copy valid pages into target doc
  const copiedPages = await destDoc.copyPages(srcDoc, validPageIndices);
  
  // Map index mapping
  const indexMapping: Record<number, number> = {}; // newPageIndex -> originalPageIndex
  for (let i = 0; i < copiedPages.length; i++) {
    const page = copiedPages[i];
    const origIdx = validPageIndices[i];
    indexMapping[i] = origIdx;

    // Apply rotation
    const mods = pageMods[origIdx];
    const rotation = mods ? mods.rotation : 0;
    if (rotation !== 0) {
      page.setRotation(degrees(rotation));
    }

    destDoc.addPage(page);
  }

  // 5. Draw Annotations on copied pages
  const newPages = destDoc.getPages();
  for (let newIdx = 0; newIdx < newPages.length; newIdx++) {
    const page = newPages[newIdx];
    const origIdx = indexMapping[newIdx];
    const pageAnns = annotations[origIdx] || [];
    
    const pageHeight = page.getHeight();
    const pageWidth = page.getWidth();

    // Determine visual orientation / sizing for rotation correction
    const isRotated = page.getRotation().angle % 180 !== 0;
    const workingHeight = isRotated ? pageWidth : pageHeight;
    const workingWidth = isRotated ? pageHeight : pageWidth;

    for (const ann of pageAnns) {
      if (ann.type === 'text') {
        // Check if this text annotation has actually been modified or moved
        const isModified = ann.originalText === undefined || 
                           ann.text !== ann.originalText ||
                           (ann.originalX !== undefined && Math.abs(ann.x - ann.originalX) > 0.1) ||
                           (ann.originalY !== undefined && Math.abs(ann.y - ann.originalY) > 0.1);
                           
        if (!isModified) {
          continue; // Skip drawing unmodified text annotations
        }

        const { r, g, b } = hexToRgb(ann.color);
        
        let selectedFont = helveticaFont;
        const family = ann.fontFamily || 'Helvetica';
        const isB = ann.bold;
        const isI = ann.italic;

        if (family === 'Helvetica') {
          if (isB && isI) selectedFont = helveticaBoldObliqueFont;
          else if (isB) selectedFont = helveticaBoldFont;
          else if (isI) selectedFont = helveticaObliqueFont;
          else selectedFont = helveticaFont;
        } else if (family === 'Times') {
          if (isB && isI) selectedFont = timesBoldItalicFont;
          else if (isB) selectedFont = timesBoldFont;
          else if (isI) selectedFont = timesItalicFont;
          else selectedFont = timesFont;
        } else if (family === 'Courier') {
          if (isB && isI) selectedFont = courierBoldObliqueFont;
          else if (isB) selectedFont = courierBoldFont;
          else if (isI) selectedFont = courierObliqueFont;
          else selectedFont = courierFont;
        } else if (GOOGLE_FONTS_URLS[family]) {
          try {
            const urls = GOOGLE_FONTS_URLS[family];
            let url = urls.regular;
            if (isB && isI && urls.boldItalic) url = urls.boldItalic;
            else if (isB && urls.bold) url = urls.bold;
            else if (isI && urls.italic) url = urls.italic;

            const ttfBytes = await fetchFont(url);
            selectedFont = await destDoc.embedFont(ttfBytes);
          } catch (e) {
            console.error(`Error loading Google Font ${family}, falling back to Helvetica`, e);
            selectedFont = helveticaFont;
          }
        }

        const originalLinesCount = (ann as any).originalTextLines ? (ann as any).originalTextLines.length : 1;
        const wasResized = (ann as any).originalWidth !== undefined && Math.abs((ann.w || 0) - (ann as any).originalWidth) > 0.5;
        const shouldWrap = ann.text.includes('\n') || originalLinesCount > 1 || wasResized;

        let textLines: string[];
        if (ann.text.includes('\n')) {
          textLines = ann.text.split('\n');
        } else if (originalLinesCount <= 1 && !wasResized) {
          textLines = [ann.text];
        } else if (ann.w) {
          textLines = wrapText(ann.text, selectedFont, ann.fontSize, ann.w);
        } else {
          textLines = [ann.text];
        }

        textLines.forEach((lineText, k) => {
          const textWidth = selectedFont.widthOfTextAtSize(lineText, ann.fontSize);
          let xOffset = 0;
          if (ann.align === 'center' && ann.w) {
            xOffset = Math.max(0, (ann.w - textWidth) / 2);
          } else if (ann.align === 'right' && ann.w) {
            xOffset = Math.max(0, ann.w - textWidth);
          }

          const lineY = (ann.h && !shouldWrap)
            ? (workingHeight - ann.y - ann.h + 2)
            : (workingHeight - ann.y - (ann.fontSize * 0.8) - (k * ann.fontSize * 1.2));

          page.drawText(lineText, {
            x: ann.x + xOffset,
            y: lineY,
            size: ann.fontSize,
            font: selectedFont,
            color: rgb(r, g, b),
          });

          if (ann.underline) {
            const lineWidth = ann.w ? Math.min(ann.w, textWidth) : textWidth;
            page.drawLine({
              start: { x: ann.x + xOffset, y: lineY - 2 },
              end: { x: ann.x + xOffset + lineWidth, y: lineY - 2 },
              thickness: 1,
              color: rgb(r, g, b),
            });
          }
        });
      } else if (ann.type === 'drawing') {
        const { r, g, b } = hexToRgb(ann.color);
        if (ann.points.length < 2) continue;
        
        for (let j = 1; j < ann.points.length; j++) {
          const p1 = ann.points[j - 1];
          const p2 = ann.points[j];
          page.drawLine({
            start: { x: p1.x, y: workingHeight - p1.y },
            end: { x: p2.x, y: workingHeight - p2.y },
            thickness: ann.width,
            color: rgb(r, g, b),
          });
        }
      } else if (ann.type === 'shape') {
        const strokeRgb = hexToRgb(ann.strokeColor);
        const fillRgb = ann.fillColor ? hexToRgb(ann.fillColor) : undefined;
        
        if (ann.shapeType === 'rect') {
          page.drawRectangle({
            x: ann.x,
            y: workingHeight - ann.y - ann.h,
            width: ann.w,
            height: ann.h,
            borderColor: rgb(strokeRgb.r, strokeRgb.g, strokeRgb.b),
            borderWidth: ann.strokeWidth,
            color: fillRgb ? rgb(fillRgb.r, fillRgb.g, fillRgb.b) : undefined,
          });
        } else if (ann.shapeType === 'circle') {
          page.drawEllipse({
            x: ann.x + ann.w / 2,
            y: workingHeight - ann.y - ann.h / 2,
            xScale: ann.w / 2,
            yScale: ann.h / 2,
            borderColor: rgb(strokeRgb.r, strokeRgb.g, strokeRgb.b),
            borderWidth: ann.strokeWidth,
            color: fillRgb ? rgb(fillRgb.r, fillRgb.g, fillRgb.b) : undefined,
          });
        } else if (ann.shapeType === 'line') {
          page.drawLine({
            start: { x: ann.x, y: workingHeight - ann.y },
            end: { x: ann.x + ann.w, y: workingHeight - (ann.y + ann.h) },
            thickness: ann.strokeWidth,
            color: rgb(strokeRgb.r, strokeRgb.g, strokeRgb.b),
          });
        }
      } else if (ann.type === 'signature' || ann.type === 'image') {
        try {
          const imgBytes = base64ToUint8Array(ann.imageBase64);
          let embeddedImage;
          try {
            embeddedImage = await destDoc.embedPng(imgBytes);
          } catch {
            embeddedImage = await destDoc.embedJpg(imgBytes);
          }
          page.drawImage(embeddedImage, {
            x: ann.x,
            y: workingHeight - ann.y - ann.h,
            width: ann.w,
            height: ann.h,
            opacity: ann.opacity !== undefined ? ann.opacity : 1,
          });
        } catch (e) {
          console.error('Error al incrustar imagen en el PDF:', e);
        }
      } else if (ann.type === 'redact') {
        page.drawRectangle({
          x: ann.x,
          y: workingHeight - ann.y - ann.h,
          width: ann.w,
          height: ann.h,
          color: rgb(0, 0, 0),
        });
      }
    }

    // 6. Draw Watermark if configured
    if (watermark && watermark.text.trim() !== '') {
      const wFont = await destDoc.embedFont(StandardFonts.HelveticaBold);
      const wColor = hexToRgb(watermark.color);
      
      page.drawText(watermark.text, {
        x: workingWidth / 4,
        y: workingHeight / 2,
        size: watermark.fontSize,
        font: wFont,
        color: rgb(wColor.r, wColor.g, wColor.b),
        opacity: watermark.opacity,
        rotate: degrees(watermark.angle),
      });
    }
  }

  // 6.5 Write Bookmarks (Outlines)
  if (bookmarks && bookmarks.length > 0) {
    try {
      const outlinesDictRef = destDoc.context.nextRef();
      const outlineItemRefs = bookmarks.map(() => destDoc.context.nextRef());
      const pages = destDoc.getPages();

      bookmarks.forEach((bookmark, i) => {
        const pageIdx = bookmark.pageIndex;
        if (pageIdx < pages.length) {
          const pageRef = pages[pageIdx].ref;
          const itemDict = destDoc.context.obj({
            Title: PDFString.of(bookmark.title),
            Parent: outlinesDictRef,
            Dest: [pageRef, 'XYZ', null, null, null],
          });
          if (i > 0) {
            itemDict.set(PDFName.of('Prev'), outlineItemRefs[i - 1]);
          }
          if (i < bookmarks.length - 1) {
            itemDict.set(PDFName.of('Next'), outlineItemRefs[i + 1]);
          }
          destDoc.context.assign(outlineItemRefs[i], itemDict);
        }
      });

      const outlinesDict = destDoc.context.obj({
        Type: 'Outlines',
        First: outlineItemRefs[0],
        Last: outlineItemRefs[outlineItemRefs.length - 1],
        Count: bookmarks.length,
      });

      destDoc.context.assign(outlinesDictRef, outlinesDict);
      destDoc.catalog.set(PDFName.of('Outlines'), outlinesDictRef);
    } catch (err) {
      console.error('Error writing outline bookmarks to PDF:', err);
    }
  }

  // 7. Compile and return Uint8Array bytes
  let pdfBytes = await destDoc.save();

  // 8. Apply Security Settings if configured (via Electron IPC to qpdf)
  if (security && (security.userPassword || security.ownerPassword)) {
    try {
      if (window.electronAPI?.encryptPdf) {
        const result = await window.electronAPI.encryptPdf(
          pdfBytes,
          security.userPassword || '',
          security.ownerPassword || ''
        );
        if (result.success && result.data) {
          pdfBytes = result.data;
        } else {
          console.warn('No se pudo cifrar el PDF:', result.error);
        }
      }
    } catch (e) {
      console.warn('El cifrado de PDF no está disponible en este entorno:', e);
    }
  }

  return pdfBytes;
}

// Replace text directly in PDF content stream (edits the actual text, not overlay)
// Fallback method using pdf-lib internal operators (fragile, for simple PDFs only)
async function replacePdfTextFallback(
  pdfBytes: Uint8Array,
  pageIndex: number,
  oldText: string,
  newText: string,
  targetIndex?: number
): Promise<Uint8Array | null> {
  const doc = await PDFDocument.load(pdfBytes);
  const pages = doc.getPages();
  if (pageIndex >= pages.length) return null;
  const page = pages[pageIndex];
  const pageNode = (page as any).node;

  // Normalize to ensure Contents is a PDFArray of stream refs
  pageNode.normalize();
  const { Contents } = pageNode.normalizedEntries();
  if (!Contents) return null;

  let replaced = false;
  let currentIndex = 0;

  for (let i = 0; i < Contents.size(); i++) {
    const item = Contents.get(i);
    const ref = item instanceof PDFRef ? item : null;
    if (!ref) continue;

    const obj = doc.context.lookup(ref);
    if (!obj) continue;

    // Access operators array (private property, accessed via any cast)
    const operators: PDFOperator[] | undefined = (obj as any).operators;
    if (!operators || !Array.isArray(operators)) continue;

    for (let j = 0; j < operators.length; j++) {
      const op = operators[j];
      const opName = (op as any).name as string;
      const args: any[] = (op as any).args || [];

      if (opName === 'Tj' && args.length > 0) {
        const decoded = decodeTextArg(args[0]);
        if (decoded !== null && decoded === oldText) {
          if (targetIndex === undefined || currentIndex === targetIndex) {
            args[0] = makeTextArg(newText);
            replaced = true;
          }
          currentIndex++;
        }
      } else if (opName === 'TJ' && args.length > 0) {
        const arr = args[0];
        if (arr && typeof arr.asArray === 'function') {
          const elements = arr.asArray() as any[];
          let fullText = '';
          for (const el of elements) {
            const d = decodeTextArg(el);
            if (d !== null) fullText += d;
          }
          if (fullText.includes(oldText)) {
            if (targetIndex === undefined || currentIndex === targetIndex) {
              const newFullText = fullText.replace(oldText, newText);
              // Rebuild TJ array: distribute text among string elements, keep numbers as-is
              let remaining = newFullText;
              const newElements: any[] = [];
              for (const el of elements) {
                const d = decodeTextArg(el);
                if (d !== null) {
                  const take = Math.min(d.length, remaining.length);
                  newElements.push(makeTextArg(remaining.slice(0, take)));
                  remaining = remaining.slice(take);
                } else {
                  newElements.push(el);
                }
              }
              // Clear and refill
              while (arr.size() > 0) arr.remove(0);
              for (const el of newElements) arr.push(el);
              replaced = true;
            }
            currentIndex++;
          }
        }
      } else if ((opName === "'" || opName === '"') && args.length > 0) {
        const decoded = decodeTextArg(args[0]);
        if (decoded !== null && decoded === oldText) {
          if (targetIndex === undefined || currentIndex === targetIndex) {
            args[0] = makeTextArg(newText);
            replaced = true;
          }
          currentIndex++;
        }
      }
    }
  }

  if (!replaced) return null;
  return await doc.save();
}

function decodeTextArg(arg: any): string | null {
  if (!arg) return null;
  if (typeof arg.decodeText === 'function') {
    try { return arg.decodeText(); } catch { return null; }
  }
  return null;
}

function makeTextArg(text: string): PDFString | PDFHexString {
  // Use hex string for texts with special chars that would break PDF parentheses
  if (/[\(\)\\\n\r\t\b\f]/.test(text)) {
    return PDFHexString.fromText(text);
  }
  return PDFString.of(text);
}

// ─── MuPDF-based text replacement (professional content stream editing) ───

/**
 * Replace text in a PDF content stream using MuPDF WASM.
 * Handles all PDF encodings, CID fonts, compressed streams natively.
 */
export async function replacePdfTextWithMuPDF(
  pdfBytes: Uint8Array,
  pageIndex: number,
  oldText: string,
  newText: string,
  targetIndex?: number
): Promise<Uint8Array | null> {
  const mupdf = await getMuPDF();

  const doc = mupdf.PDFDocument.openFromBuffer(pdfBytes);
  try {
    const page = doc.loadPage(pageIndex);
    const pageObj = page.getObject();

    // /Contents can be a single stream or an array of streams
    const contents = pageObj.get('Contents');
    if (!contents) return null;

    const escaped = escapeRegex(oldText);
    let replaced = false;
    
    const state = { currentIndex: 0 };

    const processStream = (stream: any): boolean => {
      const buf = stream.readStream();
      const content: string = buf.asString();

      const newContent = replaceInContentStreamStr(content, escaped, newText, targetIndex, state);
      if (newContent === content) return false;

      stream.writeStream(new mupdf.Buffer(newContent));
      return true;
    };

    if (contents.isArray()) {
      for (let i = 0; i < contents.length; i++) {
        const item = contents.get(i).resolve();
        if (item.isStream()) {
          if (processStream(item)) replaced = true;
        }
      }
    } else if (contents.isStream()) {
      if (processStream(contents)) replaced = true;
    }

    if (!replaced) return null;

    const outBuf = doc.saveToBuffer('compress');
    return outBuf.asUint8Array();
  } finally {
    try { doc.destroy(); } catch {}
  }
}

function unescapePdfString(str: string): string {
  return str
    .replace(/\\([()\\])/g, '$1') // unescape ( ) \
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

/**
 * Perform string replacement inside PDF content stream text operators.
 * Handles Tj, TJ, ', " operators.
 */
function replaceInContentStreamStr(
  content: string,
  escaped: string,
  newText: string,
  targetIndex?: number,
  state?: { currentIndex: number }
): string {
  const targetStr = unescapePdfString(escaped);
  const curState = state || { currentIndex: 0 };

  // 1. Simple operators: (oldText) Tj, (oldText) ', (oldText) "
  // We search for text inside parentheses. Matches (string) Tj or ' or "
  const simpleTextRegex = /\(((?:[^()\\]|\\.)*)\)\s*(Tj|'|")/g;
  let result = content.replace(simpleTextRegex, (match, strContent, op) => {
    const unescapedVal = unescapePdfString(strContent);
    if (unescapedVal === targetStr) {
      if (targetIndex === undefined || curState.currentIndex === targetIndex) {
        curState.currentIndex++;
        return `(${newText}) ${op}`;
      }
      curState.currentIndex++;
    }
    return match;
  });

  // 2. TJ arrays: [... (text) ...] TJ
  const tjRegex = /\[([^\]]*)\]\s*TJ/g;
  result = result.replace(tjRegex, (_match, inner: string) => {
    const stringRegex = /\(((?:[^()\\]|\\.)*)\)/g;
    const newInner = inner.replace(stringRegex, (subMatch, strContent) => {
      const unescapedVal = unescapePdfString(strContent);
      if (unescapedVal === targetStr) {
        if (targetIndex === undefined || curState.currentIndex === targetIndex) {
          curState.currentIndex++;
          return `(${newText})`;
        }
        curState.currentIndex++;
      }
      return subMatch;
    });
    return `[${newInner}] TJ`;
  });

  return result;
}

/**
 * Unified text replacement: try MuPDF first, fall back to pdf-lib internals.
 */
export async function replacePdfText(
  pdfBytes: Uint8Array,
  pageIndex: number,
  oldText: string,
  newText: string,
  targetIndex?: number
): Promise<Uint8Array | null> {
  // Attempt MuPDF-based replacement
  try {
    const result = await replacePdfTextWithMuPDF(pdfBytes, pageIndex, oldText, newText, targetIndex);
    if (result) return result;
  } catch (e) {
    console.warn('MuPDF text replacement failed, falling back to pdf-lib:', e);
  }

  // Fallback to pdf-lib internal operator manipulation
  return replacePdfTextFallback(pdfBytes, pageIndex, oldText, newText, targetIndex);
}

// PDF Merger utility
export async function mergePdfs(pdfList: { name: string; data: Uint8Array }[]): Promise<Uint8Array> {
  const mergedDoc = await PDFDocument.create();
  
  for (const pdfItem of pdfList) {
    const doc = await PDFDocument.load(pdfItem.data);
    const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => mergedDoc.addPage(page));
  }
  
  return await mergedDoc.save();
}
