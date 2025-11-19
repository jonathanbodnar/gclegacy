import { join } from 'path';

type CanvasFactory = {
  createCanvas: (width: number, height: number) => {
    width: number;
    height: number;
    getContext: (type: '2d') => any;
    toBuffer: (type?: string) => Buffer;
  };
  Path2D?: any;
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
  const pdfjsLib = await loadPdfJs();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    standardFontDataUrl: getStandardFontPath(),
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
      if (lib?.GlobalWorkerOptions) {
        lib.GlobalWorkerOptions.workerSrc = null;
      }
      return lib;
    } catch (legacyError) {
      const fallback = await loadModule('pdfjs-dist');
      if (fallback?.GlobalWorkerOptions) {
        fallback.GlobalWorkerOptions.workerSrc = null;
      }
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

function loadCanvasModule(): CanvasFactory {
  if (canvasModule) {
    return canvasModule;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    canvasModule = require('canvas');
    if (canvasModule && canvasModule.Path2D && typeof (globalThis as any).Path2D === 'undefined') {
      (globalThis as any).Path2D = canvasModule.Path2D;
    }
    return canvasModule!;
  } catch (error: any) {
    const hint =
      "The 'canvas' package is required for PDF rendering. Install it with `npm install canvas` and ensure its native dependencies (cairo/pango/libpng/jpeg/giflib) are available.";
    const message = error?.message
      ? `${error.message}. ${hint}`
      : hint;
    throw new Error(message);
  }
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
