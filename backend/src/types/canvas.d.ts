declare module "@napi-rs/canvas" {
  export interface CanvasRenderingContext2D {
    drawImage(...args: any[]): void;
    createImageData(width: number, height: number): ImageData;
    createImageData(
      data: Uint8ClampedArray,
      width: number,
      height: number
    ): ImageData;
  }

  export interface Canvas {
    width: number;
    height: number;
    getContext(type: "2d"): CanvasRenderingContext2D;
    toBuffer(type?: string): Buffer;
  }

  export class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(
      dataOrWidth: Uint8ClampedArray | number,
      heightOrWidth?: number,
      height?: number
    );
  }

  export function createCanvas(width: number, height: number): Canvas;
}
