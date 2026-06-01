// jsdom polyfills required for @xyflow/react to mount and measure nodes.
// Without these, React Flow renders nodes with `visibility: hidden`, making them
// inaccessible to Testing Library queries.

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    const contentRect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1280,
      bottom: 800,
      width: 1280,
      height: 800,
      toJSON: () => ({}),
    } as DOMRectReadOnly;

    this.callback([{ target, contentRect } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }

  unobserve() {}
  disconnect() {}
}

class DOMMatrixReadOnlyMock {
  readonly m22: number;

  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale === undefined ? 1 : Number.parseFloat(scale);
  }
}

if (typeof global.HTMLElement !== "undefined") {
  global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  global.DOMMatrixReadOnly = DOMMatrixReadOnlyMock as unknown as typeof DOMMatrixReadOnly;

  Object.defineProperties(global.HTMLElement.prototype, {
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style.height) || 120;
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style.width) || 220;
      },
    },
  });
}

if (typeof global.SVGElement !== "undefined") {
  (global.SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
}
