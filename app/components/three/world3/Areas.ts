import * as THREE from "three";
import * as Layout from "./Layout";
import { AREAS, areaAt, distToRect, padLocal, pointInPad } from "./Layout";
import type {
    AreaBuilder,
    AreaContext,
    AreaDef,
    AreaHandle,
    AreaId,
    RuntimeInfo,
    Word3D,
    WorldInteractable,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────
// Areas. Builds every REGISTERED area from AREAS, keeps the interactable
// registry, and resolves the active pad with rect tests in the pad's local
// frame (§5.3). Area modules (Wave 2) register a builder:
//
//     registerArea("projects", build);   // build(ctx: AreaContext): AreaHandle
//
// The Experience imports the area modules once (side-effect registration,
// `areas/index.ts`) before calling Areas.build(). Zero registered areas is a
// valid world (Wave 1).
//
// Wave 1 integration:
// - `areas.group` must be in the scene BEFORE build(): every 3D word an area
//   creates through ctx.text3d is reset() (armed) right after its builder
//   returns, so colliders exist before the first physics step (W1-B rule:
//   place a word's group under ctx.group inside the builder, never move it).
// - A builder that throws is logged and skipped (its group removed), so one
//   broken area never takes the whole world down.
// - cull(): areas whose rect is further than `distance` from the focus are
//   hidden (and not updated), §9.2 text budget.
// ─────────────────────────────────────────────────────────────────────────

const BUILDERS = new Map<AreaId, AreaBuilder>();

/** Registers (or replaces) the builder for an area. */
export function registerArea(id: AreaId, builder: AreaBuilder): void {
    BUILDERS.set(id, builder);
}

export function registeredAreaIds(): AreaId[] {
    return AREAS.filter((a) => BUILDERS.has(a.id)).map((a) => a.id);
}

/** Services every area receives (AreaContext minus the per-area fields). */
export type AreaServices = Omit<AreaContext, "group" | "def" | "layout" | "addInteractable">;

interface BuiltArea {
    def: AreaDef;
    group: THREE.Group;
    handle: AreaHandle;
}

export class Areas {
    /** Root group holding one child group per built area. */
    readonly group = new THREE.Group();
    private built = new Map<AreaId, BuiltArea>();
    private interactables = new Set<WorldInteractable>();
    private activeItem: WorldInteractable | null = null;

    constructor(private services: AreaServices) {
        this.group.name = "areas";
    }

    /** Builds every registered area (table order). Safe to call once. */
    build(builders: ReadonlyMap<AreaId, AreaBuilder> = BUILDERS): void {
        for (const def of AREAS) {
            const builder = builders.get(def.id);
            if (!builder || this.built.has(def.id)) continue;
            const group = new THREE.Group();
            group.name = `area:${def.id}`;
            this.group.add(group);
            const words: Word3D[] = [];
            const unregister: (() => void)[] = [];
            const ctx: AreaContext = {
                ...this.services,
                text3d: {
                    word: (text, opts) => {
                        const w = this.services.text3d.word(text, opts);
                        words.push(w);
                        return w;
                    },
                },
                group,
                def,
                layout: Layout,
                addInteractable: (i) => {
                    const off = this.addInteractable(i);
                    unregister.push(off);
                    return off;
                },
            };
            try {
                const handle = builder(ctx);
                // Arm every word now (W1-B): colliders before the first physics step.
                for (const w of words) w.reset();
                this.built.set(def.id, { def, group, handle });
            } catch (err) {
                console.error(`[world3] area "${def.id}" failed to build; skipping it`, err);
                for (const off of unregister) off();
                group.removeFromParent();
            }
        }
    }

    /** Ids of the areas that were built (registered and not failed). */
    get builtIds(): AreaId[] {
        return [...this.built.keys()];
    }

    // ── Interactables ────────────────────────────────────────────────────
    addInteractable(i: WorldInteractable): () => void {
        this.interactables.add(i);
        return () => {
            if (this.activeItem === i) {
                i.setActive?.(false);
                this.activeItem = null;
            }
            this.interactables.delete(i);
        };
    }

    get active(): WorldInteractable | null {
        return this.activeItem;
    }

    get interactableCount(): number {
        return this.interactables.size;
    }

    /**
     * The interactable whose pad contains (x, z), tested in each pad's local
     * frame; ties go to the pad whose centre is nearest (normalised).
     */
    findAt(x: number, z: number): WorldInteractable | null {
        let best: WorldInteractable | null = null;
        let bestScore = Infinity;
        for (const i of this.interactables) {
            if (!pointInPad(i.pad, x, z)) continue;
            const { lx, lz } = padLocal(i.pad, x, z);
            const score = Math.hypot(lx / i.pad.w, lz / i.pad.d);
            if (score < bestScore) {
                bestScore = score;
                best = i;
            }
        }
        return best;
    }

    /** Re-evaluates the active pad for the car position; returns it. */
    updateActive(carX: number, carZ: number): WorldInteractable | null {
        const next = this.findAt(carX, carZ);
        if (next !== this.activeItem) {
            this.activeItem?.setActive?.(false);
            next?.setActive?.(true);
            this.activeItem = next;
        }
        return next;
    }

    /**
     * Runs the active interactable synchronously (call from the input handler).
     * `openPanel` receives content-only interactables. Returns false if nothing
     * is active.
     */
    interact(openPanel: (i: WorldInteractable) => void): boolean {
        const i = this.activeItem;
        if (!i) return false;
        if (i.onInteract) i.onInteract();
        else if (i.content) openPanel(i);
        return true;
    }

    // ── Areas ────────────────────────────────────────────────────────────
    /** First area rect (table order) containing (x, z). */
    areaAt(x: number, z: number): AreaDef | null {
        return areaAt(x, z);
    }

    handle(id: AreaId): AreaHandle | undefined {
        return this.built.get(id)?.handle;
    }

    update(dt: number, t: number, rt: RuntimeInfo): void {
        this.updateActive(rt.carPos.x, rt.carPos.z);
        for (const b of this.built.values()) {
            if (b.group.visible) b.handle.update?.(dt, t, rt);
        }
    }

    /** Shows an area's group (culling at CONFIG.text.cullDistance is the integrator's). */
    setAreaVisible(id: AreaId, visible: boolean): void {
        const b = this.built.get(id);
        if (b) b.group.visible = visible;
    }

    /** Hides (and stops updating) every built area whose rect is further than `distance` from (x, z). */
    cull(x: number, z: number, distance: number): void {
        for (const b of this.built.values()) b.group.visible = distToRect(b.def.rect, x, z) <= distance;
    }

    reset(id?: AreaId): void {
        for (const b of this.built.values()) if (!id || b.def.id === id) b.handle.reset?.();
    }

    dispose(): void {
        this.activeItem?.setActive?.(false);
        this.activeItem = null;
        for (const b of this.built.values()) {
            b.handle.dispose?.();
            b.group.removeFromParent();
        }
        this.built.clear();
        this.interactables.clear();
        this.group.removeFromParent();
    }
}
