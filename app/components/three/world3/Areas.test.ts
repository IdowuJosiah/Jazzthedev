import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Areas, type AreaServices } from "./Areas";
import { AREA_BY_ID } from "./Layout";
import type { AreaBuilder, AreaId, RuntimeInfo, Word3D, WorldInteractable } from "./types";
import { Disposal } from "./utils/disposal";

function makeServices() {
    const words: Word3D[] = [];
    const services = {
        text3d: {
            word: () => {
                const w: Word3D = { group: new THREE.Group(), letters: [], reset: vi.fn() };
                words.push(w);
                return w;
            },
        },
        disposal: new Disposal(),
    } as unknown as AreaServices;
    return { services, words };
}

const rt = (x: number, z: number): RuntimeInfo => ({
    carPos: new THREE.Vector3(x, 0, z),
    carSpeed: 0,
    reducedMotion: false,
    muted: true,
    isTouch: false,
});

describe("Areas (Wave 1 integration)", () => {
    it("builds a world with zero registered areas", () => {
        const { services } = makeServices();
        const areas = new Areas(services);
        areas.build(new Map());
        expect(areas.builtIds).toEqual([]);
        expect(areas.group.children).toHaveLength(0);
        areas.update(1 / 60, 0, rt(0, 0));
        expect(areas.active).toBeNull();
        expect(areas.interact(() => {})).toBe(false);
        areas.cull(0, 0, 70);
        areas.dispose();
    });

    it("arms (reset()) every 3D word an area created, right after its builder returns", () => {
        const { services, words } = makeServices();
        const areas = new Areas(services);
        const order: string[] = [];
        const build: AreaBuilder = (ctx) => {
            const w = ctx.text3d.word("JAZZ", { cap: 4, depth: 1.2, color: "#24222B", dynamic: true, curveSegments: 12 });
            ctx.group.add(w.group);
            expect(w.reset).not.toHaveBeenCalled();
            order.push("built");
            return { group: ctx.group };
        };
        areas.build(new Map<AreaId, AreaBuilder>([["welcome", build]]));
        expect(order).toEqual(["built"]);
        expect(words).toHaveLength(1);
        expect(words[0].reset).toHaveBeenCalledTimes(1);
        expect(areas.builtIds).toEqual(["welcome"]);
    });

    it("skips an area whose builder throws, and drops its interactables", () => {
        const { services } = makeServices();
        const areas = new Areas(services);
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const pad = { x: 0, z: 0, w: 4, d: 4, faceCamera: false };
        const broken: AreaBuilder = (ctx) => {
            ctx.addInteractable({ pad, prompt: { title: "X", action: "Open" }, areaId: "welcome" });
            throw new Error("boom");
        };
        const ok: AreaBuilder = (ctx) => ({ group: ctx.group });
        areas.build(
            new Map<AreaId, AreaBuilder>([
                ["welcome", broken],
                ["hub", ok],
            ])
        );
        expect(err).toHaveBeenCalledTimes(1);
        err.mockRestore();
        expect(areas.builtIds).toEqual(["hub"]);
        expect(areas.interactableCount).toBe(0);
        expect(areas.group.children.map((c) => c.name)).toEqual(["area:hub"]);
    });

    it("culls areas by rect distance from the focus, and only updates visible ones", () => {
        const { services } = makeServices();
        const areas = new Areas(services);
        const updates: AreaId[] = [];
        const builder =
            (id: AreaId): AreaBuilder =>
            (ctx) => ({ group: ctx.group, update: () => updates.push(id) });
        areas.build(
            new Map<AreaId, AreaBuilder>([
                ["welcome", builder("welcome")],
                ["credits", builder("credits")],
            ])
        );
        const w = AREA_BY_ID.welcome.arrival;
        areas.cull(w.x, w.z, 70);
        areas.update(1 / 60, 0, rt(w.x, w.z));
        expect(updates).toEqual(["welcome"]);
        const groups = Object.fromEntries(areas.group.children.map((c) => [c.name, c.visible]));
        expect(groups).toEqual({ "area:welcome": true, "area:credits": false });
    });

    it("interact runs onInteract synchronously, else hands content to openPanel", () => {
        const { services } = makeServices();
        const areas = new Areas(services);
        const pad = { x: 0, z: 0, w: 4, d: 4, faceCamera: false };
        const ran = vi.fn();
        const item: WorldInteractable = { pad, prompt: { title: "A", action: "Open" }, areaId: "welcome", onInteract: ran };
        areas.addInteractable(item);
        areas.updateActive(0, 0);
        const panel = vi.fn();
        expect(areas.interact(panel)).toBe(true);
        expect(ran).toHaveBeenCalledTimes(1);
        expect(panel).not.toHaveBeenCalled();
    });
});
