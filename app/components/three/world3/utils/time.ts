type TickCb = (dt: number, elapsed: number) => void;

/** rAF loop with a clamped delta (prevents physics blow-ups after a tab stall). */
export class Time {
    elapsed = 0;
    delta = 1 / 60;
    /** Largest dt handed to callbacks, in seconds (100 ms). */
    static readonly MAX_DT = 0.1;
    private last = 0;
    private raf = 0;
    private running = false;
    private cbs: TickCb[] = [];

    get isRunning() {
        return this.running;
    }

    /** Adds a per-frame callback; returns a function that removes it. */
    onTick(cb: TickCb): () => void {
        this.cbs.push(cb);
        return () => {
            this.cbs = this.cbs.filter((c) => c !== cb);
        };
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.last = performance.now();
        const loop = (now: number) => {
            if (!this.running) return;
            this.raf = requestAnimationFrame(loop);
            // clamp so a stalled tab doesn't teleport the simulation
            const dt = Math.min((now - this.last) / 1000, Time.MAX_DT);
            this.last = now;
            this.delta = dt;
            this.elapsed += dt;
            for (const cb of this.cbs) cb(dt, this.elapsed);
        };
        this.raf = requestAnimationFrame(loop);
    }

    stop() {
        this.running = false;
        cancelAnimationFrame(this.raf);
    }

    dispose() {
        this.stop();
        this.cbs = [];
    }
}
