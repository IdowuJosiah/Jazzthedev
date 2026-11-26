import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Areas, type AreaServices } from "./Areas";
import { CONFIG } from "./Config";
import { AREA_BY_ID } from "./Layout";
import type { AreaBuilder, AreaId, RuntimeInfo, Word3D, WorldInteractable } from "./types";
import { Disposal } from "./utils/disposal";

function makeServices() {
    const words: Word3D[] = [];
    const services = {
        text3d: {
            word: (_text: string, opts: { dynamic: boolean }) => {
                // A dynamic word's letters carry bodies; the fake only needs one to be present.
                const letters = opts.dynamic ? ([{ body: {} }] as unknown as Word3D["letters"]) : [];
                const w: Word3D = { group: new THREE.Group(), letters, reset: vi.fn() };
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

    describe("knockable titles (dynamic words Areas sends home)", () => {
        const RESET = CONFIG.physics.heroLetterResetDistance;
        const titleBuilder =
            (dynamic: boolean, ownsWordReset = false): AreaBuilder =>
            (ctx) => {
                const w = ctx.text3d.word("MUSIC", { cap: 2.4, depth: 0.6, color: "#000000", dynamic, curveSegments: 8 });
                w.group.position.set(10, 0, -20);
                ctx.group.add(w.group);
                return { group: ctx.group, ownsWordReset };
            };

        it("resets a dynamic title once on the car's near → far change, even while culled", () => {
            const { services, words } = makeServices();
            const areas = new Areas(services);
            areas.build(new Map<AreaId, AreaBuilder>([["music", titleBuilder(true)]]));
            const reset = words[0].reset as ReturnType<typeof vi.fn>;
            reset.mockClear(); // the arming call
            areas.update(1 / 60, 0, rt(10, -20)); // near
            areas.update(1 / 60, 0, rt(10 + RESET - 1, -20)); // still near
            expect(reset).not.toHaveBeenCalled();
            areas.setAreaVisible("music", false);
            areas.update(1 / 60, 0, rt(10 + RESET + 1, -20)); // crosses out (culled)
            areas.update(1 / 60, 0, rt(10 + RESET + 40, -20)); // stays far
            expect(reset).toHaveBeenCalledTimes(1);
            areas.update(1 / 60, 0, rt(10, -18)); // back near
            areas.update(1 / 60, 0, rt(10, -20 - RESET - 1)); // leaves again
            expect(reset).toHaveBeenCalledTimes(2);
        });

        it("resetWords() and reset(id) send dynamic titles home; static ones and self-owned words are left alone", () => {
            const { services, words } = makeServices();
            const areas = new Areas(services);
            areas.build(
                new Map<AreaId, AreaBuilder>([
                    ["welcome", titleBuilder(true, true)],
                    ["music", titleBuilder(true)],
                    ["eko", titleBuilder(false)],
                ])
            );
            // Areas build in table order, so find each word by the area group it sits in.
            const resetOf = (id: AreaId) =>
                words.find((w) => w.group.parent?.name === `area:${id}`)!.reset as ReturnType<typeof vi.fn>;
            const [own, loose, fixed] = [resetOf("welcome"), resetOf("music"), resetOf("eko")];
            for (const r of [own, loose, fixed]) r.mockClear();
            areas.resetWords();
            expect([own.mock.calls.length, loose.mock.calls.length, fixed.mock.calls.length]).toEqual([0, 1, 0]);
            areas.reset("music");
            expect(loose).toHaveBeenCalledTimes(2);
            areas.update(1 / 60, 0, rt(10 + RESET + 1, -20));
            expect(own).not.toHaveBeenCalled(); // Welcome's own update() handles it
        });
    });
});
