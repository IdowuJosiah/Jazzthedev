import * as THREE from "three";
import { PALETTE } from "../Config";

/** Gradient sky dome with a sun/moon glow and night stars. Rendered on BackSide. */
export function skyMaterial() {
    return new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
            uDayTop: { value: new THREE.Color(0x2b6fd6) },
            uDayBottom: { value: new THREE.Color(0xf6d7a8) },
            uNightTop: { value: new THREE.Color(PALETTE.skyTop) },
            uNightBottom: { value: new THREE.Color(PALETTE.skyBottom) },
            uHorizon: { value: new THREE.Color(PALETTE.horizon) },
            uSunDir: { value: new THREE.Vector3(0, 1, 0) },
            uNight: { value: 0.6 },
        },
        vertexShader: /* glsl */ `
            varying vec3 vDir;
            void main() {
                vDir = normalize(position);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */ `
            precision highp float;
            varying vec3 vDir;
            uniform vec3 uDayTop, uDayBottom, uNightTop, uNightBottom, uHorizon, uSunDir;
            uniform float uNight;

            float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }

            void main(){
                float h = clamp(vDir.y, -1.0, 1.0);
                float t = smoothstep(-0.05, 0.55, h);
                vec3 top = mix(uDayTop, uNightTop, uNight);
                vec3 bottom = mix(uDayBottom, uNightBottom, uNight);
                vec3 col = mix(bottom, top, t);
                // warm horizon band
                float band = exp(-abs(h) * 6.0);
                col = mix(col, uHorizon, band * (0.5 - uNight*0.25));

                // sun / moon glow
                float d = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
                float glow = pow(d, 80.0);
                vec3 glowCol = mix(vec3(1.0,0.85,0.6), vec3(0.8,0.9,1.0), uNight);
                col += glowCol * glow * (1.0 - uNight*0.3);
                col += uHorizon * pow(d, 6.0) * 0.12 * (1.0 - uNight);

                // stars at night
                if (uNight > 0.3 && h > 0.02) {
                    vec3 sp = floor(vDir * 240.0);
                    float s = hash(sp);
                    float star = step(0.9975, s) * smoothstep(0.3, 0.8, uNight) * smoothstep(0.0, 0.3, h);
                    col += vec3(star);
                }
                gl_FragColor = vec4(col, 1.0);
            }
        `,
    });
}

export function updateSky(mat: THREE.ShaderMaterial, sunDir: THREE.Vector3, night: number) {
    mat.uniforms.uSunDir.value.copy(sunDir);
    mat.uniforms.uNight.value = night;
}
