declare module 'canvas' {
  export interface CanvasRenderingContext2D {
    drawImage(...args: any[]): void;
  }

  export interface Canvas {
    width: number;
    height: number;
    getContext(type: '2d'): CanvasRenderingContext2D;
    toBuffer(type?: string): Buffer;
  }

  export function createCanvas(width: number, height: number): Canvas;
}
