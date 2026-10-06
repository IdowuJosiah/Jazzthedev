import * as THREE from "three";
import { CONFIG, PALETTE } from "../Config";

/**
 * Lagoon water with a real shoreline: the fragment shader reconstructs the
 * terrain height (same function as Environment) to get water depth, then draws
 * sandy shallows, animated foam at the waterline, and deep blue offshore.
 */
export function waterMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true,
        fog: true,
        uniforms: {
            uTime: { value: 0 },
            uNight: { value: 0.6 },
            uSunDir: { value: new THREE.Vector3(0, 1, 0) },
            uDeep: { value: new THREE.Color(PALETTE.water) },
            uShallow: { value: new THREE.Color(0x3fa6c9) },
            uFoam: { value: new THREE.Color(0xdff6ff) },
            uNeon: { value: new THREE.Color(PALETTE.neonCyan) },
            uShore: { value: CONFIG.world.shoreRadius },
            uLevel: { value: CONFIG.world.waterLevel },
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
                vec4 wp = modelMatrix * vec4(position, 1.0);
                float w = sin(wp.x*0.08 + uTime*0.8) * 0.16
                        + cos(wp.z*0.065 - uTime*0.6) * 0.14
                        + sin((wp.x+wp.z)*0.12 + uTime)*0.04;
                wp.y += w;
                vWave = w;
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
            uniform float uTime, uNight, uHasNormal, uShore, uLevel;
            uniform vec3 uSunDir, uDeep, uShallow, uFoam, uNeon;
            uniform sampler2D uNormalMap;
            #include <fog_pars_fragment>

            // Must match Environment.terrainHeight()
            float terrainH(vec2 p){
                float r = length(p);
                float mask = clamp((uShore + 24.0 - r)/48.0, 0.0, 1.0);
                float m = mask*mask*(3.0-2.0*mask);
                float dunes = sin(p.x*0.045)*cos(p.y*0.05)*1.1
                            + sin(p.x*0.11+1.3)*cos(p.y*0.09-0.7)*0.5
                            + sin((p.x+p.y)*0.2)*0.18;
                float seabed = -7.0 + sin(p.x*0.03)*0.8;
                return mix(seabed, dunes, m);
            }
            float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1)))*43758.5); }

            void main(){
                float depth = uLevel - terrainH(vWorld.xz);   // >0 = underwater
                vec3 viewDir = normalize(cameraPosition - vWorld);

                // ripple normal
                vec3 nrm = vec3(0.0,1.0,0.0);
                if (uHasNormal > 0.5) {
                    vec2 uvA = vWorld.xz * 0.03 + vec2(uTime*0.01, uTime*0.013);
                    vec2 uvB = vWorld.xz * 0.05 - vec2(uTime*0.012, uTime*0.008);
                    vec3 nA = texture2D(uNormalMap, uvA).rgb*2.0-1.0;
                    vec3 nB = texture2D(uNormalMap, uvB).rgb*2.0-1.0;
                    nrm = normalize(vec3(0.0,1.0,0.0)+vec3(nA.x+nB.x,0.0,nA.y+nB.y)*0.3);
                }

                float fres = pow(1.0 - max(viewDir.y,0.0), 3.0);
                vec3 col = mix(uShallow, uDeep, smoothstep(0.2, 6.0, depth));

                // sun/moon specular streak
                float spec = pow(max(dot(reflect(-uSunDir, nrm), viewDir), 0.0), 60.0);
                vec3 streak = mix(vec3(1.0,0.82,0.5), uNeon, uNight);
                col += streak * spec * (0.5 + uNight*0.6);

                // animated foam band at the shoreline
                float wobble = sin(vWorld.x*2.0 + uTime*2.0)*0.08 + sin(vWorld.z*2.3 - uTime*1.7)*0.08;
                float foam = smoothstep(0.9+wobble, 0.0, depth) * smoothstep(-0.05, 0.1, depth);
                float sparkle = step(0.6, hash(floor(vWorld.xz*3.0)+floor(uTime*4.0)));
                col = mix(col, uFoam, foam*(0.6+0.4*sparkle));

                col = mix(col, col*0.55, uNight*0.35);
                float alpha = clamp(0.80 + fres*0.18 + foam*0.3, 0.0, 1.0);
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
