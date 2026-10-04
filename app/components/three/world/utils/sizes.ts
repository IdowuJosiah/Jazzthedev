type ResizeCb = (w: number, h: number, dpr: number) => void;

/** Tracks the canvas container size + device pixel ratio with a capped DPR. */
export class Sizes {
    width = 1;
    height = 1;
    dpr = 1;
    private dprCap = 2;
    private cbs = new Set<ResizeCb>();
    private ro?: ResizeObserver;

    constructor(private el: HTMLElement) {
        this.measure();
        this.ro = new ResizeObserver(() => this.measure());
        this.ro.observe(el);
        window.addEventListener("orientationchange", this.measure);
    }

    setDprCap(cap: number) {
        this.dprCap = cap;
        this.measure();
    }

    private measure = () => {
        const w = Math.max(1, this.el.clientWidth);
        const h = Math.max(1, this.el.clientHeight);
        const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
        if (w === this.width && h === this.height && dpr === this.dpr) return;
        this.width = w;
        this.height = h;
        this.dpr = dpr;
        for (const cb of this.cbs) cb(w, h, dpr);
    };

    onResize(cb: ResizeCb) {
        this.cbs.add(cb);
    }

    dispose() {
        this.ro?.disconnect();
        window.removeEventListener("orientationchange", this.measure);
        this.cbs.clear();
    }
}
