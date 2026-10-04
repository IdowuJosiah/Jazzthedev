import * as THREE from "three";
import { ZONE_ACCENT } from "./Config";
import type { Disposal } from "./utils/disposal";
import type { Physics } from "./Physics";
import type { Environment } from "./Environment";
import { makeTextSprite } from "./utils/labels";
import type { WorldInteractable, ZoneInfo } from "./types";
import {
    sectors,
    frontendProjects,
    journeyStops,
    skillTotems,
    ekoMilestones,
    musicPillars,
    type InfoContent,
} from "@/app/field/content/world";

const R = 108; // district distance from island centre

interface ZoneDef {
    id: "frontend" | "music" | "eko" | "journey";
    angle: number;
    landmark: "spire" | "stage" | "monolith" | "arch";
}

const ZONE_DEFS: ZoneDef[] = [
    { id: "frontend", angle: 0.7, landmark: "spire" },
    { id: "music", angle: 2.2, landmark: "stage" },
    { id: "eko", angle: 3.6, landmark: "monolith" },
    { id: "journey", angle: 5.0, landmark: "arch" },
];

export class Zones {
    group = new THREE.Group();
    interactables: WorldInteractable[] = [];
    zones: ZoneInfo[] = [];
    /** zone centres keyed by id (fast-travel + minimap) */
    centers: Record<string, THREE.Vector3> = {};
    private halos: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; base: number }[] = [];
    private pulses: { mat: THREE.MeshStandardMaterial; base: number; accent: THREE.Color }[] = [];

    constructor(
        private disposal: Disposal,
        private physics: Physics,
        private env: Environment
    ) {
        for (const def of ZONE_DEFS) this.buildZone(def);
    }

    private sector(id: string) {
        return sectors.find((s) => s.id === id)!;
    }

    private buildZone(def: ZoneDef) {
        const accent = ZONE_ACCENT[def.id];
        const cx = Math.cos(def.angle) * R;
        const cz = Math.sin(def.angle) * R;
        const cy = this.env.heightAt(cx, cz);
        const center = new THREE.Vector3(cx, cy, cz);
        this.centers[def.id] = center;
        const sector = this.sector(def.id);
        this.zones.push({ id: def.id, name: sector.name, x: cx, z: cz, color: accent, visited: false });

        // ── Ground pad: dark disc + glowing accent ring ──
        const pad = new THREE.Mesh(
            this.track(new THREE.CircleGeometry(16, 48)),
            this.track(
                new THREE.MeshStandardMaterial({ color: 0x0a0e22, roughness: 0.9, metalness: 0.1 })
            )
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(cx, cy + 0.04, cz);
        pad.receiveShadow = true;
        this.group.add(pad);

        for (const rr of [10, 13.5, 15.6]) {
            const ringMat = new THREE.MeshBasicMaterial({
                color: accent,
                transparent: true,
                opacity: 0.5,
            });
            this.track(ringMat);
            const ring = new THREE.Mesh(this.track(new THREE.RingGeometry(rr - 0.18, rr, 64)), ringMat);
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(cx, cy + 0.06, cz);
            this.group.add(ring);
        }

        // Accent light hovering over the pad.
        const light = new THREE.PointLight(accent, 120, 70, 2);
        light.position.set(cx, cy + 10, cz);
        this.group.add(light);

        // ── Landmark ──
        this.buildLandmark(def, center, accent);

        // ── District sign ──
        const sign = makeTextSprite(sector.name.toUpperCase(), {
            color: "#" + new THREE.Color(accent).getHexString(),
            font: 54,
            maxWidth: 14,
        });
        this.disposal.track(sign.texture);
        this.disposal.track(sign.material);
        sign.sprite.position.set(cx, cy + 9.5, cz);
        this.group.add(sign.sprite);

        // Zone intro interactable at the pad edge (facing centre of island).
        this.addInteractable({
            position: new THREE.Vector3(cx, cy + 1.4, cz),
            radius: 15,
            zoneId: def.id,
            prompt: { title: sector.name, sub: sector.blurb, kind: "zone" },
            content: {
                title: sector.name,
                sub: "District overview",
                body: sector.blurb,
                accent,
            },
        });

        // ── Billboards for this zone's content ──
        const items = this.zoneItems(def.id);
        const n = items.length;
        const spread = Math.PI * 1.25;
        const start = def.angle + Math.PI - spread / 2;
        const br = 11;
        items.forEach((content, i) => {
            const a = n > 1 ? start + (spread * i) / (n - 1) : def.angle + Math.PI;
            const bx = cx + Math.cos(a) * br;
            const bz = cz + Math.sin(a) * br;
            const by = this.env.heightAt(bx, bz);
            this.buildBillboard(new THREE.Vector3(bx, by, bz), center, accent, content, def.id);
        });

        // Skills totems live in the journey district.
        if (def.id === "journey") {
            skillTotems.forEach((s, i) => {
                const a = def.angle - 0.5 + i * 0.5;
                const tx = cx + Math.cos(a) * 20;
                const tz = cz + Math.sin(a) * 20;
                const ty = this.env.heightAt(tx, tz);
                this.buildTotem(new THREE.Vector3(tx, ty, tz), accent, {
                    title: s.category,
                    sub: s.proof,
                    body: s.skills.join("   ·   "),
                    accent,
                });
            });
        }
    }

    private zoneItems(id: string): InfoContent[] {
        switch (id) {
            case "frontend":
                return frontendProjects.map((t) => ({
                    title: t.title,
                    sub: t.pitch,
                    body: t.description,
                    image: t.image,
                    tags: t.tags,
                    links: t.liveUrl ? [{ label: "Visit site", url: t.liveUrl }] : undefined,
                    accent: ZONE_ACCENT.frontend,
                }));
            case "music":
                return musicPillars.map((p) => ({
                    title: p.title,
                    body: p.body,
                    links: p.url ? [{ label: "Listen", url: p.url }] : undefined,
                    accent: ZONE_ACCENT.music,
                }));
            case "eko":
                return ekoMilestones.map((m) => ({
                    title: m.title,
                    sub: m.step,
                    body: m.body,
                    links: m.liveUrl ? [{ label: "Open Eko", url: m.liveUrl }] : undefined,
                    accent: ZONE_ACCENT.eko,
                }));
            case "journey":
                return journeyStops.map((s) => ({
                    title: s.title,
                    sub: s.year,
                    body: s.body,
                    accent: ZONE_ACCENT.journey,
                }));
            default:
                return [];
        }
    }

    private buildBillboard(
        pos: THREE.Vector3,
        faceToward: THREE.Vector3,
        accent: number,
        content: InfoContent,
        zoneId: string
    ) {
        const g = new THREE.Group();
        g.position.copy(pos);

        // post
        const post = new THREE.Mesh(
            this.track(new THREE.CylinderGeometry(0.12, 0.12, 2.6, 8)),
            this.track(new THREE.MeshStandardMaterial({ color: 0x1a2140, roughness: 0.6 }))
        );
        post.position.y = 1.3;
        post.castShadow = true;
        g.add(post);

        // panel with emissive frame
        const frameMat = this.trackPulse(accent, 1.6);
        const frame = new THREE.Mesh(this.track(new THREE.BoxGeometry(3.1, 1.9, 0.12)), frameMat);
        frame.position.y = 3.1;
        g.add(frame);
        const face = new THREE.Mesh(
            this.track(new THREE.PlaneGeometry(2.8, 1.6)),
            this.track(new THREE.MeshStandardMaterial({ color: 0x0a0e22, roughness: 0.8 }))
        );
        face.position.set(0, 3.1, 0.07);
        g.add(face);

        // title label
        const label = makeTextSprite(content.title, { font: 46, maxWidth: 3.0 });
        this.disposal.track(label.texture);
        this.disposal.track(label.material);
        label.sprite.position.set(0, 3.1, 0.14);
        g.add(label.sprite);

        // ground halo
        const halo = this.makeHalo(accent);
        halo.position.y = 0.06;
        g.add(halo);

        g.lookAt(faceToward.x, pos.y + 3.1, faceToward.z);
        this.group.add(g);

        this.addInteractable({
            position: new THREE.Vector3(pos.x, pos.y + 1.5, pos.z),
            radius: 7,
            zoneId,
            prompt: { title: content.title, sub: content.sub ?? "View details", kind: "zone" },
            content,
            halo,
        });
    }

    private buildTotem(pos: THREE.Vector3, accent: number, content: InfoContent) {
        const g = new THREE.Group();
        g.position.copy(pos);
        const mat = this.trackPulse(accent, 1.2);
        for (let i = 0; i < 3; i++) {
            const box = new THREE.Mesh(
                this.track(new THREE.BoxGeometry(1.4 - i * 0.3, 0.7, 1.4 - i * 0.3)),
                i === 1 ? mat : this.track(new THREE.MeshStandardMaterial({ color: 0x151b38, roughness: 0.7 }))
            );
            box.position.y = 0.4 + i * 0.72;
            box.castShadow = true;
            g.add(box);
        }
        const halo = this.makeHalo(accent);
        halo.position.y = 0.06;
        g.add(halo);
        this.group.add(g);
        this.addInteractable({
            position: new THREE.Vector3(pos.x, pos.y + 1.4, pos.z),
            radius: 6,
            zoneId: "journey",
            prompt: { title: content.title, sub: "Skills", kind: "zone" },
            content,
            halo,
        });
    }

    private buildLandmark(def: ZoneDef, center: THREE.Vector3, accent: number) {
        const { x: cx, z: cz } = center;
        const cy = center.y;
        const mat = this.trackPulse(accent, 1.3);
        const dark = this.track(new THREE.MeshStandardMaterial({ color: 0x12173a, roughness: 0.6, metalness: 0.3 }));

        if (def.landmark === "spire") {
            const base = new THREE.Mesh(this.track(new THREE.CylinderGeometry(2.4, 3, 2, 6)), dark);
            base.position.set(cx, cy + 1, cz);
            base.castShadow = true;
            this.group.add(base);
            const spire = new THREE.Mesh(this.track(new THREE.ConeGeometry(1.5, 12, 6)), mat);
            spire.position.set(cx, cy + 8.5, cz);
            spire.castShadow = true;
            this.group.add(spire);
            this.addLandmarkCollider(cx, cy, cz, 3, 3);
        } else if (def.landmark === "monolith") {
            const slab = new THREE.Mesh(this.track(new THREE.BoxGeometry(3.4, 11, 1.2)), dark);
            slab.position.set(cx, cy + 5.5, cz);
            slab.castShadow = true;
            this.group.add(slab);
            const glyph = new THREE.Mesh(this.track(new THREE.TorusGeometry(2.1, 0.22, 10, 24)), mat);
            glyph.position.set(cx, cy + 7, cz);
            this.group.add(glyph);
            this.addLandmarkCollider(cx, cy, cz, 1.8, 0.7);
        } else if (def.landmark === "stage") {
            const stage = new THREE.Mesh(this.track(new THREE.CylinderGeometry(6, 6.4, 1, 24)), dark);
            stage.position.set(cx, cy + 0.5, cz);
            stage.receiveShadow = true;
            this.group.add(stage);
            // equalizer bars
            for (let i = 0; i < 7; i++) {
                const bar = new THREE.Mesh(
                    this.track(new THREE.BoxGeometry(0.7, 4 + (i % 3) * 1.4, 0.7)),
                    this.trackPulse(accent, 1.8)
                );
                bar.position.set(cx - 3 + i, cy + 3, cz - 3);
                this.group.add(bar);
            }
        } else if (def.landmark === "arch") {
            const archMat = mat;
            const leftLeg = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.9, 10, 0.9)), archMat);
            leftLeg.position.set(cx - 4, cy + 5, cz);
            this.group.add(leftLeg);
            const rightLeg = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.9, 10, 0.9)), archMat);
            rightLeg.position.set(cx + 4, cy + 5, cz);
            this.group.add(rightLeg);
            const top = new THREE.Mesh(this.track(new THREE.BoxGeometry(9.9, 0.9, 0.9)), archMat);
            top.position.set(cx, cy + 10, cz);
            this.group.add(top);
            this.addLandmarkCollider(cx - 4, cy, cz, 0.6, 0.6);
            this.addLandmarkCollider(cx + 4, cy, cz, 0.6, 0.6);
        }
    }

    private addLandmarkCollider(x: number, y: number, z: number, hx: number, hz: number) {
        this.physics.addFixedCuboid({ x: hx, y: 6, z: hz }, { x, y: y + 6, z });
    }

    private makeHalo(accent: number) {
        const mat = new THREE.MeshBasicMaterial({
            color: accent,
            transparent: true,
            opacity: 0.0,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        this.track(mat);
        const mesh = new THREE.Mesh(this.track(new THREE.RingGeometry(2.4, 3.1, 40)), mat);
        mesh.rotation.x = -Math.PI / 2;
        this.halos.push({ mesh, mat, base: 0.0 });
        return mesh;
    }

    private trackPulse(accent: number, intensity: number) {
        const col = new THREE.Color(accent);
        const mat = new THREE.MeshStandardMaterial({
            color: accent,
            emissive: accent,
            emissiveIntensity: intensity,
            roughness: 0.4,
            metalness: 0.2,
        });
        this.track(mat);
        this.pulses.push({ mat, base: intensity, accent: col });
        return mat;
    }

    private addInteractable(it: WorldInteractable) {
        this.interactables.push(it);
    }

    private track<T extends { dispose: () => void }>(x: T): T {
        return this.disposal.track(x);
    }

    /** @param nearHalo the halo currently in range (brightened), if any */
    update(elapsed: number, nearHalo: THREE.Object3D | null, beat: number) {
        for (const h of this.halos) {
            const active = h.mesh === nearHalo;
            const target = active ? 0.55 + Math.sin(elapsed * 6) * 0.2 : 0.12;
            h.mat.opacity += (target - h.mat.opacity) * 0.15;
            const s = active ? 1 + Math.sin(elapsed * 6) * 0.06 : 1;
            h.mesh.scale.setScalar(s);
        }
        for (const p of this.pulses) {
            p.mat.emissiveIntensity = p.base * (0.85 + Math.sin(elapsed * 2) * 0.12 + beat * 0.5);
        }
    }
}
