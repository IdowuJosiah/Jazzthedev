import * as THREE from "three";

/**
 * Collects GPU-backed resources and frees them on teardown. Every module that
 * creates geometries/materials/textures/render-targets registers them here so
 * navigating away or re-initializing never leaks VRAM.
 */
export class Disposal {
    private items = new Set<{ dispose: () => void }>();
    private fns = new Set<() => void>();

    track<T extends { dispose: () => void }>(item: T): T {
        this.items.add(item);
        return item;
    }

    /** Track a plain teardown callback (event listeners, timers, GUIs...). */
    onDispose(fn: () => void) {
        this.fns.add(fn);
    }

    /** Recursively track every geometry/material/texture under an Object3D. */
    trackObject(obj: THREE.Object3D) {
        obj.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.geometry) this.track(mesh.geometry);
            const mat = (mesh as THREE.Mesh).material;
            if (mat) {
                const mats = Array.isArray(mat) ? mat : [mat];
                for (const m of mats) {
                    this.track(m);
                    for (const key of Object.keys(m)) {
                        const val = (m as unknown as Record<string, unknown>)[key];
                        if (val instanceof THREE.Texture) this.track(val);
                    }
                }
            }
        });
    }

    dispose() {
        for (const fn of this.fns) {
            try {
                fn();
            } catch {
                /* ignore teardown errors */
            }
        }
        for (const item of this.items) {
            try {
                item.dispose();
            } catch {
                /* ignore */
            }
        }
        this.items.clear();
        this.fns.clear();
    }
}
