import * as THREE from "three";

/**
 * Turns a (possibly multi-mesh) model into one InstancedMesh per sub-mesh and
 * places `placements` copies. Each sub-mesh keeps its own geometry/material but
 * draws every copy in a single call — cheap foliage/rock fields.
 */
export function buildInstances(
    model: THREE.Object3D,
    placements: THREE.Matrix4[],
    tint?: THREE.Color
): { group: THREE.Group; meshes: THREE.InstancedMesh[] } {
    model.updateMatrixWorld(true);
    const group = new THREE.Group();
    const meshes: THREE.InstancedMesh[] = [];
    const count = placements.length;
    const tmp = new THREE.Matrix4();

    model.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh) return;
        const mat = (
            Array.isArray(src.material) ? src.material[0] : src.material
        ).clone() as THREE.MeshStandardMaterial;
        if (tint && "color" in mat) mat.color.multiply(tint);
        const inst = new THREE.InstancedMesh(src.geometry, mat, count);
        inst.castShadow = true;
        inst.receiveShadow = true;
        const local = src.matrixWorld; // relative to model root (root at origin)
        for (let i = 0; i < count; i++) {
            tmp.multiplyMatrices(placements[i], local);
            inst.setMatrixAt(i, tmp);
        }
        inst.instanceMatrix.needsUpdate = true;
        meshes.push(inst);
        group.add(inst);
    });

    return { group, meshes };
}
