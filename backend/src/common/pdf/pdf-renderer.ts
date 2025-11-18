import { join } from 'path';

type CanvasFactory = {
  createCanvas: (width: number, height: number) => {
    width: number;
    height: number;
    getContext: (type: '2d') => any;
    toBuffer: (type?: string) => Buffer;
  };
  Path2D?: any;
  ImageData?: any;
};

let canvasModule: CanvasFactory | null = null;
let standardFontDataUrl: string | null = null;
let canvasPolyfillsInitialized = false;
let pdfjsLibPromise: Promise<any> | null = null;
const dynamicImport = new Function(
  'specifier',
  'return import(specifier);',
) as (specifier: string) => Promise<any>;

export interface PdfPageImage {
  buffer: Buffer;
  widthPx: number;
  heightPx: number;
}

export interface PdfRenderOptions {
  dpi?: number;
  maxPages?: number;
}

export interface PdfPageRenderOptions {
  dpi?: number;
}

export async function getPdfJsLib(): Promise<any> {
  return loadPdfJs();
}

export async function renderPdfToImages(
  pdfBuffer: Buffer,
  options: PdfRenderOptions = {},
): Promise<PdfPageImage[]> {
  // Ensure canvas polyfills are initialized before loading pdfjs
  ensureCanvasPolyfills();
  const pdfjsLib = await loadPdfJs();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    standardFontDataUrl: getStandardFontPath(),
    disableWorker: true,
  });
  const pdfDoc = await loadingTask.promise;
  const dpi = normalizeDpi(options.dpi);
  const totalPages = pdfDoc.numPages;
  const limit = options.maxPages ? Math.min(options.maxPages, totalPages) : totalPages;

  const results: PdfPageImage[] = [];
  for (let pageNum = 1; pageNum <= limit; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    results.push(await renderPageWithDpi(page, dpi));
  }

  return results;
}

export async function renderPdfPage(
  page: any,
  options: PdfPageRenderOptions = {},
): Promise<PdfPageImage> {
  // Ensure canvas polyfills are initialized
  ensureCanvasPolyfills();
  const dpi = normalizeDpi(options.dpi);
  return renderPageWithDpi(page, dpi);
}

async function loadPdfJs(): Promise<any> {
  if (pdfjsLibPromise) {
    return pdfjsLibPromise;
  }

  const loadModule = async (specifier: string) => {
    const mod = await dynamicImport(specifier);
    return (mod as any).default ?? mod;
  };

  pdfjsLibPromise = (async () => {
    try {
      const lib = await loadModule('pdfjs-dist/legacy/build/pdf.js');
      return lib;
    } catch (legacyError) {
      const fallback = await loadModule('pdfjs-dist');
      return fallback;
    }
  })();

  return pdfjsLibPromise;
}

function normalizeDpi(dpi?: number): number {
  const value = typeof dpi === 'number' && dpi > 0 ? dpi : 220;
  return Math.max(value, 1);
}

async function renderPageWithDpi(page: any, dpi: number): Promise<PdfPageImage> {
  const canvasLib = loadCanvasModule();
  const { createCanvas } = canvasLib;
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  const width = Math.max(Math.ceil(viewport.width), 1);
  const height = Math.max(Math.ceil(viewport.height), 1);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  await page.render({ canvasContext: context, viewport }).promise;

  return {
    buffer: canvas.toBuffer('image/png'),
    widthPx: width,
    heightPx: height,
  };
}

function ensureCanvasPolyfills(): void {
  if (canvasPolyfillsInitialized) {
    return;
  }

  try {
    // Load canvas module first
    if (!canvasModule) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      canvasModule = require('@napi-rs/canvas');
    }
    
    // Polyfill Path2D if available
    if (canvasModule && canvasModule.Path2D && typeof (globalThis as any).Path2D === 'undefined') {
      (globalThis as any).Path2D = canvasModule.Path2D;
    }
    
    // Polyfill ImageData - @napi-rs/canvas should export it, but ensure it's global
    if (typeof (globalThis as any).ImageData === 'undefined') {
      if (canvasModule && canvasModule.ImageData) {
        // Use the ImageData from @napi-rs/canvas if available
        (globalThis as any).ImageData = canvasModule.ImageData;
      } else {
        // Fallback: create ImageData polyfill using canvas context
        // We'll create a small temporary canvas to get access to createImageData
        const tempCanvas = canvasModule.createCanvas(1, 1);
        const tempCtx = tempCanvas.getContext('2d');
        
        // Create ImageData constructor that matches the browser API
        (globalThis as any).ImageData = class ImageData {
          data: Uint8ClampedArray;
          width: number;
          height: number;
          
          constructor(dataOrWidth: Uint8ClampedArray | number, heightOrWidth?: number, height?: number) {
            if (typeof dataOrWidth === 'number') {
              // Constructor(width, height)
              const width = dataOrWidth;
              const h = heightOrWidth || 1;
              const imgData = tempCtx.createImageData(width, h);
              this.data = imgData.data;
              this.width = width;
              this.height = h;
            } else {
              // Constructor(data, width, height)
              const data = dataOrWidth;
              const width = heightOrWidth || 1;
              const h = height || 1;
              const imgData = tempCtx.createImageData(width, h);
              imgData.data.set(data);
              this.data = imgData.data;
              this.width = width;
              this.height = h;
            }
          }
        };
      }
    }
    
    canvasPolyfillsInitialized = true;
  } catch (error: any) {
    // Don't throw here, let loadCanvasModule handle it
    console.warn('Failed to initialize canvas polyfills:', error.message);
  }
}

function loadCanvasModule(): CanvasFactory {
  if (canvasModule) {
    return canvasModule;
  }

  // Ensure polyfills are set up
  ensureCanvasPolyfills();

  if (!canvasModule) {
    const hint =
      "The '@napi-rs/canvas' package is required for PDF rendering. Install it with `npm install @napi-rs/canvas`.";
    throw new Error(hint);
  }
  
  return canvasModule;
}

function getStandardFontPath(): string {
  if (standardFontDataUrl) {
    return standardFontDataUrl;
  }
  const pkgPath = require.resolve('pdfjs-dist/package.json');
  const baseDir = join(pkgPath, '..', 'build', 'standard_fonts');
  standardFontDataUrl = baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
  return standardFontDataUrl;
}
