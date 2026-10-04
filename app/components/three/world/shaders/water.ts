import * as THREE from "three";
import { PALETTE } from "../Config";

/** Stylized lagoon water — gentle waves, fresnel, a sun/neon streak, night sparkle. */
export function waterMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true,
        fog: true,
        uniforms: {
            uTime: { value: 0 },
            uNight: { value: 0.6 },
            uSunDir: { value: new THREE.Vector3(0, 1, 0) },
            uDeep: { value: new THREE.Color(PALETTE.water) },
            uShallow: { value: new THREE.Color(0x2a6f8f) },
            uNeon: { value: new THREE.Color(PALETTE.neonCyan) },
            uNormalMap: { value: null as THREE.Texture | null },
            uHasNormal: { value: 0 },
            ...THREE.UniformsLib.fog,
        },
        vertexShader: /* glsl */ `
            varying vec3 vWorld;
            varying float vWave;
            uniform float uTime;
            #include <fog_pars_vertex>
            void main(){
                vec3 p = position;
                float w = sin(p.x*0.08 + uTime*0.8) * 0.18
                        + cos(p.z*0.065 - uTime*0.6) * 0.16
                        + sin((p.x+p.z)*0.12 + uTime)*0.05;
                p.y += w;
                vWave = w;
                vec4 wp = modelMatrix * vec4(p, 1.0);
                vWorld = wp.xyz;
                vec4 mvPosition = viewMatrix * wp;
                gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
            }
        `,
        fragmentShader: /* glsl */ `
            precision highp float;
            varying vec3 vWorld;
            varying float vWave;
            uniform float uTime, uNight, uHasNormal;
            uniform vec3 uSunDir, uDeep, uShallow, uNeon;
            uniform sampler2D uNormalMap;
            #include <fog_pars_fragment>

            void main(){
                vec3 viewDir = normalize(cameraPosition - vWorld);
                float fres = pow(1.0 - max(viewDir.y, 0.0), 3.0);
                vec3 col = mix(uDeep, uShallow, clamp(vWave*1.5+0.5, 0.0, 1.0));
                col = mix(col, uShallow, fres*0.6);

                // ripple normal from the tiling normal map (two scrolling layers)
                vec3 nrm = vec3(0.0,1.0,0.0);
                if (uHasNormal > 0.5) {
                    vec2 uvA = vWorld.xz * 0.03 + vec2(uTime*0.01, uTime*0.013);
                    vec2 uvB = vWorld.xz * 0.05 - vec2(uTime*0.012, uTime*0.008);
                    vec3 nA = texture2D(uNormalMap, uvA).rgb * 2.0 - 1.0;
                    vec3 nB = texture2D(uNormalMap, uvB).rgb * 2.0 - 1.0;
                    nrm = normalize(vec3(0.0,1.0,0.0) + vec3(nA.x+nB.x, 0.0, nA.y+nB.y)*0.35);
                }

                // sun / moon streak across the surface
                float spec = pow(max(dot(reflect(-uSunDir, nrm), viewDir), 0.0), 40.0);
                vec3 streakCol = mix(vec3(1.0,0.8,0.5), uNeon, uNight);
                col += streakCol * spec * (0.6 + uNight*0.6);

                // neon shimmer at night
                float shimmer = sin(vWorld.x*0.4 + uTime*2.0)*sin(vWorld.z*0.35 - uTime*1.6);
                col += uNeon * max(shimmer,0.0) * 0.05 * uNight;

                col = mix(col, col*0.5, uNight*0.4);
                float alpha = 0.86 + fres*0.14;
                gl_FragColor = vec4(col, alpha);
                #include <fog_fragment>
            }
        `,
    });
}

export function updateWater(
    mat: THREE.ShaderMaterial,
    time: number,
    night: number,
    sunDir: THREE.Vector3
) {
    mat.uniforms.uTime.value = time;
    mat.uniforms.uNight.value = night;
    mat.uniforms.uSunDir.value.copy(sunDir);
}
