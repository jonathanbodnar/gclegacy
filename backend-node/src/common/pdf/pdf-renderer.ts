import { join } from 'path';
import { createRequire } from 'module';

type CanvasFactory = {
  createCanvas: (
    width: number,
    height: number,
  ) => {
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

export async function renderPdfToImages(
  pdfBuffer: Buffer,
  options: PdfRenderOptions = {},
): Promise<PdfPageImage[]> {
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalStdErrWrite = process.stderr.write;

  console.warn = (...args: any[]) => {
    const message = args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return arg.message;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');

    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes('xfa') ||
      (lowerMessage.includes('rich text') &&
        (lowerMessage.includes('error') || lowerMessage.includes('occurred'))) ||
      (lowerMessage.includes('cannot destructure') && lowerMessage.includes('html')) ||
      (lowerMessage.includes('destructure property') && lowerMessage.includes('html')) ||
      (lowerMessage.includes('attributes') &&
        lowerMessage.includes('null') &&
        lowerMessage.includes('html')) ||
      (message.includes('XFA') && message.includes('parsing'))
    ) {
      return;
    }
    originalWarn.apply(console, args);
  };

  process.stderr.write = function write(chunk: any, encoding?: any, callback?: any): boolean {
    const message = chunk?.toString() || String(chunk);
    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes('xfa') ||
      (lowerMessage.includes('rich text') &&
        (lowerMessage.includes('error') || lowerMessage.includes('occurred'))) ||
      (lowerMessage.includes('cannot destructure') && lowerMessage.includes('html')) ||
      (lowerMessage.includes('destructure property') && lowerMessage.includes('html')) ||
      (lowerMessage.includes('attributes') &&
        lowerMessage.includes('null') &&
        lowerMessage.includes('html')) ||
      (message.includes('Warning:') && message.includes('XFA'))
    ) {
      if (typeof callback === 'function') {
        callback();
      }
      return true;
    }
    return originalStdErrWrite.call(process.stderr, chunk, encoding, callback);
  };

  ensureCanvasPolyfills();

  console.error = (...args: any[]) => {
    const message = args.join(' ');
    if (
      message.includes('Failed to unwrap exclusive reference') ||
      (message.includes('CanvasElement') && message.includes('napi value')) ||
      message.includes('InvalidArg') ||
      message.includes('XFA') ||
      message.includes('Cannot destructure property') ||
      (message.includes('html') && message.includes('null'))
    ) {
      return;
    }
    originalError.apply(console, args);
  };

  const originalUnhandledRejection = process.listeners('unhandledRejection');
  const unhandledRejectionHandler = (reason: any, promise: Promise<any>) => {
    if (
      reason &&
      typeof reason === 'object' &&
      (reason.code === 'InvalidArg' ||
        (reason.message &&
          (reason.message.includes('Failed to unwrap exclusive reference') ||
            reason.message.includes('CanvasElement') ||
            reason.message.includes('napi value') ||
            reason.message.includes('XFA') ||
            reason.message.includes('Cannot destructure property') ||
            (reason.message.includes('html') && reason.message.includes('null')))))
    ) {
      return;
    }
    originalUnhandledRejection.forEach((handler) => {
      try {
        handler(reason, promise);
      } catch {
        //
      }
    });
  };
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', unhandledRejectionHandler);

  try {
    const pdfjsLib = await loadPdfJs();
    let pdfDoc;
    try {
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
        standardFontDataUrl: getStandardFontPath(),
        stopAtErrors: true,
      });
      pdfDoc = await loadingTask.promise;
    } catch (loadError: any) {
      if (
        loadError?.message &&
        (loadError.message.includes('XFA') || loadError.message.includes('rich text'))
      ) {
        const retryTask = pdfjsLib.getDocument({
          data: new Uint8Array(pdfBuffer),
          standardFontDataUrl: getStandardFontPath(),
          stopAtErrors: true,
        });
        pdfDoc = await retryTask.promise;
      } else {
        throw loadError;
      }
    }

    const dpi = normalizeDpi(options.dpi);
    const totalPages = pdfDoc.numPages;
    const limit = options.maxPages ? Math.min(options.maxPages, totalPages) : totalPages;

    const results: PdfPageImage[] = [];
    for (let pageNum = 1; pageNum <= limit; pageNum += 1) {
      try {
        const page = await pdfDoc.getPage(pageNum);
        results.push(await renderPageWithDpi(page, dpi));
      } catch (pageError: any) {
        console.warn(
          `Failed to render page ${pageNum}: ${pageError?.message || String(pageError)}. Skipping this page.`,
        );
        continue;
      }
    }

    return results;
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
    process.stderr.write = originalStdErrWrite;
    if (typeof originalUnhandledRejection !== 'undefined') {
      process.removeAllListeners('unhandledRejection');
      originalUnhandledRejection.forEach((handler) => {
        process.on('unhandledRejection', handler);
      });
    }
  }
}

export async function renderPdfPage(
  page: any,
  options: PdfPageRenderOptions = {},
): Promise<PdfPageImage> {
  ensureCanvasPolyfills();
  const dpi = normalizeDpi(options.dpi);
  return renderPageWithDpi(page, dpi);
}

async function loadPdfJs(): Promise<any> {
  const errors: string[] = [];
  const nodeRequire = createRequire(__filename);

  ensureCanvasPolyfills();
  const canvasLib = loadCanvasModule();

  const configurePdfJs = (lib: any): any => {
    if (!lib) return lib;

    try {
      if (lib.GlobalWorkerOptions) {
        lib.GlobalWorkerOptions.workerSrc = false;
      }

      if (typeof lib.setCanvasFactory === 'function') {
        lib.setCanvasFactory({
          create(width: number, height: number) {
            const canvas = canvasLib.createCanvas(width, height);
            return {
              canvas,
              context: canvas.getContext('2d'),
            };
          },
          reset(canvasAndContext: any, width: number, height: number) {
            if (canvasAndContext?.canvas) {
              try {
                canvasAndContext.canvas.width = width;
                canvasAndContext.canvas.height = height;
              } catch {
                //
              }
            }
          },
          destroy() {
            return;
          },
        });
      }
    } catch {
      //
    }

    return lib;
  };

  try {
    const lib = nodeRequire('pdfjs-dist/legacy/build/pdf.js');
    if (lib && typeof lib.getDocument === 'function') {
      return configurePdfJs(lib);
    }
  } catch (legacyError: any) {
    errors.push(`legacy build require failed: ${legacyError.message}`);
  }

  try {
    const pdfjsModule = await import('pdfjs-dist');
    const lib = pdfjsModule.default || pdfjsModule;

    if (lib && typeof lib.getDocument === 'function') {
      return configurePdfJs(lib);
    }
    throw new Error('Module loaded but getDocument is not a function');
  } catch (importError: any) {
    const errorMsg = importError.message || String(importError);
    errors.push(`ES module import failed: ${errorMsg}`);
  }

  try {
    const lib = nodeRequire('pdfjs-dist/build/pdf.js');
    if (lib && typeof lib.getDocument === 'function') {
      return configurePdfJs(lib);
    }
  } catch (requireError: any) {
    errors.push(`build/pdf.js require failed: ${requireError.message}`);
  }

  throw new Error(
    `Failed to load pdfjs-dist. Attempted paths:\n${errors.join('\n')}\n\n` +
      'Please ensure pdfjs-dist is installed: npm install pdfjs-dist\n' +
      'Recommended: Use pdfjs-dist@^3.11.0 for CommonJS compatibility',
  );
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

  let renderTask: any = null;
  let buffer: Buffer;

  try {
    renderTask = page.render({ canvasContext: context, viewport });
    await renderTask.promise;

    buffer = canvas.toBuffer('image/png');
  } catch (renderError: any) {
    if (renderTask && typeof renderTask.cancel === 'function') {
      try {
        const cancelPromise = renderTask.cancel();
        if (cancelPromise && typeof cancelPromise.catch === 'function') {
          cancelPromise.catch(() => {});
        }
      } catch {
        //
      }
    }
    throw renderError;
  } finally {
    try {
      if (context && typeof context.clearRect === 'function') {
        context.clearRect(0, 0, width, height);
      }
    } catch {
      //
    }
  }

  return {
    buffer: buffer!,
    widthPx: width,
    heightPx: height,
  };
}

function ensureCanvasPolyfills(): void {
  if (canvasPolyfillsInitialized) {
    return;
  }

  try {
    if (!canvasModule) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      canvasModule = require('@napi-rs/canvas');
    }

    if (
      canvasModule &&
      canvasModule.Path2D &&
      typeof (globalThis as any).Path2D === 'undefined'
    ) {
      (globalThis as any).Path2D = canvasModule.Path2D;
    }

    if (
      canvasModule &&
      canvasModule.ImageData &&
      typeof (globalThis as any).ImageData === 'undefined'
    ) {
      (globalThis as any).ImageData = canvasModule.ImageData;
    }

    canvasPolyfillsInitialized = true;
  } catch (error: any) {
    throw new Error(
      `Failed to initialize canvas polyfills. Ensure @napi-rs/canvas is installed. Original error: ${error?.message}`,
    );
  }
}

function loadCanvasModule(): CanvasFactory {
  if (canvasModule) {
    return canvasModule as CanvasFactory;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    canvasModule = require('@napi-rs/canvas');
    return canvasModule as CanvasFactory;
  } catch (error: any) {
    throw new Error(
      `Failed to load @napi-rs/canvas. Please ensure it is installed. Original error: ${error?.message}`,
    );
  }
}

function getStandardFontPath(): string {
  if (standardFontDataUrl) {
    return standardFontDataUrl;
  }

  const nodeRequire = createRequire(__filename);
  const fontDir = join(
    nodeRequire.resolve('pdfjs-dist/package.json'),
    '../standard_fonts',
  );
  standardFontDataUrl = `${fontDir}/`;
  return standardFontDataUrl;
}

