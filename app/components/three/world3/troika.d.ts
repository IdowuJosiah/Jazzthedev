// Ambient types for troika-three-text@0.52.5 (its package ships no usable
// typings: no "types" field, and the generated d.ts doesn't extend Mesh).
// Only the surface the v3 world uses is typed; extend as needed.

declare module "troika-three-text" {
    import type { BufferGeometry, Color, Material, Mesh } from "three";

    export type TroikaAnchorX = number | "left" | "center" | "right" | `${number}%`;
    export type TroikaAnchorY =
        | number
        | "top"
        | "top-baseline"
        | "top-cap"
        | "top-ex"
        | "middle"
        | "bottom-baseline"
        | "bottom"
        | `${number}%`;

    export interface TroikaTextRenderInfo {
        /** [minX, minY, maxX, maxY] of the laid-out block, in local units. */
        blockBounds: [number, number, number, number];
        /** [minX, minY, maxX, maxY] of the visible glyphs. */
        visibleBounds: [number, number, number, number];
        caretPositions: Float32Array;
        lineHeight: number;
        topBaseline: number;
        cap: number;
        ex: number;
        timings: Record<string, number>;
        sdfGlyphSize: number;
    }

    export class Text extends Mesh<BufferGeometry, Material> {
        constructor();
        readonly isTroikaText: true;
        text: string;
        font: string | null;
        fontSize: number;
        fontWeight: number | "normal" | "bold";
        fontStyle: "normal" | "italic";
        lang: string | null;
        color: string | number | Color | null;
        colorRanges: Record<number, string | number | Color> | null;
        maxWidth: number;
        letterSpacing: number;
        lineHeight: number | "normal";
        textAlign: "left" | "right" | "center" | "justify";
        textIndent: number;
        whiteSpace: "normal" | "nowrap";
        overflowWrap: "normal" | "break-word";
        anchorX: TroikaAnchorX;
        anchorY: TroikaAnchorY;
        direction: "auto" | "ltr" | "rtl";
        curveRadius: number;
        depthOffset: number;
        clipRect: [number, number, number, number] | null;
        orientation: string;
        glyphGeometryDetail: number;
        sdfGlyphSize: number | null;
        gpuAccelerateSDF: boolean;
        fillOpacity: number;
        outlineWidth: number | string;
        outlineColor: string | number | Color;
        outlineOpacity: number;
        outlineBlur: number | string;
        outlineOffsetX: number | string;
        outlineOffsetY: number | string;
        strokeWidth: number | string;
        strokeColor: string | number | Color;
        strokeOpacity: number;
        unicodeFontsURL: string | null;
        /** The base material; troika derives its SDF material from it. */
        material: Material;
        readonly textRenderInfo: TroikaTextRenderInfo | null;
        /** Lays out + builds glyphs (async, worker); callback after the geometry updates. */
        sync(callback?: () => void): void;
        dispose(): void;
    }

    export interface TextBuilderConfig {
        defaultFontURL?: string | null;
        unicodeFontsURL?: string | null;
        sdfGlyphSize?: number;
        sdfExponent?: number;
        sdfMargin?: number;
        textureWidth?: number;
        useWorker?: boolean;
    }

    export function configureTextBuilder(config: TextBuilderConfig): void;

    export function preloadFont(
        options: { font?: string; characters: string | string[]; sdfGlyphSize?: number },
        callback: () => void
    ): void;

    export function dumpSDFTextures(): void;
}
