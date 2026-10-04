type TickCb = (dt: number, elapsed: number) => void;

/** rAF loop with a clamped delta (prevents physics blow-ups after a tab stall). */
export class Time {
    elapsed = 0;
    delta = 1 / 60;
    private last = 0;
    private raf = 0;
    private running = false;
    private cbs: TickCb[] = [];

    onTick(cb: TickCb) {
        this.cbs.push(cb);
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.last = performance.now();
        const loop = (now: number) => {
            if (!this.running) return;
            this.raf = requestAnimationFrame(loop);
            // clamp to 100ms so a stalled tab doesn't teleport the simulation
            const dt = Math.min((now - this.last) / 1000, 0.1);
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
