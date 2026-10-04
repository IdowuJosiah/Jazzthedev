import * as THREE from "three";

export interface LabelOpts {
    color?: string;
    bg?: string;
    font?: number; // px
    pad?: number;
    weight?: number;
    maxWidth?: number; // world units of the sprite width
}

/**
 * Crisp canvas text as a camera-facing sprite. Used for in-world signage
 * (district names, billboard titles, collectible words).
 */
export function makeTextSprite(text: string, opts: LabelOpts = {}) {
    const color = opts.color ?? "#e9ecff";
    const bg = opts.bg ?? "rgba(10,14,34,0.72)";
    const font = opts.font ?? 64;
    const pad = opts.pad ?? 28;
    const weight = opts.weight ?? 700;

    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = `${weight} ${font}px Poppins, system-ui, sans-serif`;
    const w = Math.ceil(measure.measureText(text).width) + pad * 2;
    const h = font + pad * 2;

    const canvas = document.createElement("canvas");
    const dpr = 2;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    // rounded pill background
    const r = h / 2;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = color;
    ctx.font = `${weight} ${font}px Poppins, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    const worldW = opts.maxWidth ?? 6;
    sprite.scale.set(worldW, (worldW * h) / w, 1);
    return { sprite, texture: tex, material: mat };
}
