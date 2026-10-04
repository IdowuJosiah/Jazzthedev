import * as THREE from "three";
import { PALETTE } from "../Config";

/** Instanced grass blades that bend in the wind (tip-weighted displacement). */
export function grassMaterial() {
    return new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        fog: true,
        uniforms: {
            uTime: { value: 0 },
            uBase: { value: new THREE.Color(PALETTE.grass).multiplyScalar(0.5) },
            uTip: { value: new THREE.Color(PALETTE.neonLime).multiplyScalar(0.7) },
            uWind: { value: 0.35 },
            ...THREE.UniformsLib.fog,
        },
        vertexShader: /* glsl */ `
            varying float vH;
            uniform float uTime, uWind;
            #include <common>
            #include <fog_pars_vertex>
            void main(){
                vH = uv.y;
                vec3 transformed = position;
                // instance world position for phase variation
                vec4 wp = modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0);
                float phase = wp.x * 0.3 + wp.z * 0.25;
                float sway = (sin(uTime*1.6 + phase) + sin(uTime*2.7 + phase*1.7)*0.4) * uWind;
                transformed.x += sway * uv.y * uv.y;
                transformed.z += sway * 0.4 * uv.y * uv.y;
                vec4 worldPos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
                vec4 mvPosition = viewMatrix * worldPos;
                gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
            }
        `,
        fragmentShader: /* glsl */ `
            precision highp float;
            varying float vH;
            uniform vec3 uBase, uTip;
            #include <fog_pars_fragment>
            void main(){
                vec3 col = mix(uBase, uTip, vH);
                gl_FragColor = vec4(col, 1.0);
                #include <fog_fragment>
            }
        `,
    });
}

/** One blade: a tapered quad with its pivot at the base. */
export function grassBladeGeometry() {
    const g = new THREE.PlaneGeometry(0.12, 0.9, 1, 3);
    g.translate(0, 0.45, 0);
    return g;
}
