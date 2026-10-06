import * as THREE from "three";

export interface BuildInstancesOptions {
    /** Multiplies each cloned material's colour (ignored when `material` is given). */
    tint?: THREE.Color;
    /**
     * Material override per source sub-mesh (e.g. palette Lambert from Materials.ts).
     * When omitted, the source material is cloned.
     */
    material?: (src: THREE.Material, mesh: THREE.Mesh) => THREE.Material;
    castShadow?: boolean;
    receiveShadow?: boolean;
    /** Initial drawn count (default: all placements). */
    count?: number;
}

export interface InstanceSet {
    group: THREE.Group;
    meshes: THREE.InstancedMesh[];
    /** Allocated instance count (= placements.length). */
    readonly capacity: number;
    /** Currently drawn instances. */
    readonly count: number;
    /**
     * Draws only the first `n` placements (clamped to [0, capacity]). Order the
     * placements so any prefix is a good subset (e.g. shuffled) — adaptive
     * quality cuts scenery by lowering this.
     */
    setCount(n: number): void;
    /** Draws `fraction` of the capacity (rounded). */
    setFraction(fraction: number): void;
}

/**
 * Turns a (possibly multi-mesh) model into one InstancedMesh per sub-mesh and
 * places `placements` copies. Each sub-mesh keeps its own geometry and draws
 * every copy in a single call — cheap foliage / rock / tile fields.
 */
export function buildInstances(
    model: THREE.Object3D,
    placements: THREE.Matrix4[],
    opts: BuildInstancesOptions = {}
): InstanceSet {
    model.updateMatrixWorld(true);
    const group = new THREE.Group();
    const meshes: THREE.InstancedMesh[] = [];
    const capacity = placements.length;
    const tmp = new THREE.Matrix4();

    model.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh) return;
        const srcMat = Array.isArray(src.material) ? src.material[0] : src.material;
        let mat: THREE.Material;
        if (opts.material) {
            mat = opts.material(srcMat, src);
        } else {
            mat = srcMat.clone();
            const colored = mat as THREE.Material & { color?: THREE.Color };
            if (opts.tint && colored.color) colored.color.multiply(opts.tint);
        }
        const inst = new THREE.InstancedMesh(src.geometry, mat, Math.max(1, capacity));
        inst.castShadow = opts.castShadow ?? true;
        inst.receiveShadow = opts.receiveShadow ?? true;
        const local = src.matrixWorld; // relative to model root (root at origin)
        for (let i = 0; i < capacity; i++) {
            tmp.multiplyMatrices(placements[i], local);
            inst.setMatrixAt(i, tmp);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        meshes.push(inst);
        group.add(inst);
    });

    let count = capacity;
    const set: InstanceSet = {
        group,
        meshes,
        capacity,
        get count() {
            return count;
        },
        setCount(n: number) {
            count = Math.max(0, Math.min(capacity, Math.round(n)));
            for (const m of meshes) m.count = count;
        },
        setFraction(fraction: number) {
            set.setCount(capacity * fraction);
        },
    };
    set.setCount(opts.count ?? capacity);
    return set;
}

/** Fisher–Yates shuffle with a seeded rng (in place); use before buildInstances. */
export function shuffleInPlace<T>(items: T[], rng: () => number): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = items[i];
        items[i] = items[j];
        items[j] = t;
    }
    return items;
}
