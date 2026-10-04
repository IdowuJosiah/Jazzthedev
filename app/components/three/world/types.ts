import * as THREE from "three";
import type { InfoContent } from "@/app/field/content/world";
import type { Prompt } from "./State";

/** Anything the player can drive up to and trigger with E / tap. */
export interface WorldInteractable {
    position: THREE.Vector3;
    radius: number;
    prompt: Prompt;
    /** Opens this content panel on interact (unless onInteract is set). */
    content?: InfoContent;
    /** Custom action instead of a panel (minigame, credits, collectible...). */
    onInteract?: () => void;
    /** Highlight object pulsed while in range. */
    halo?: THREE.Object3D;
    /** Zone this belongs to, for "explored" tracking + minimap. */
    zoneId?: string;
    /** Collectibles disappear once taken. */
    collected?: boolean;
    kindTag?: "collectible";
}

export interface ZoneInfo {
    id: string;
    name: string;
    x: number;
    z: number;
    color: number;
    visited: boolean;
}
