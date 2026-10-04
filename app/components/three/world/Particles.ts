import * as THREE from "three";
import { CONFIG, PALETTE, type QualityTier } from "./Config";
import type { Disposal } from "./utils/disposal";
import { makeRng } from "./utils/math";

/** Fireflies (drifting glow points) at night + an optional rain layer. */
export class Particles {
    group = new THREE.Group();
    private fireflies?: THREE.Points;
    private ffMat?: THREE.ShaderMaterial;
    private rain?: THREE.Points;
    private rainMat?: THREE.PointsMaterial;
    private rainVel: Float32Array = new Float32Array(0);
    private rainOn = false;

    constructor(
        private disposal: Disposal,
        quality: QualityTier,
        private focusRadius = 90
    ) {
        this.buildFireflies(quality);
        this.buildRain(quality);
    }

    private buildFireflies(quality: QualityTier) {
        const count = CONFIG.particles.fireflies[quality];
        if (count <= 0) return;
        const rng = makeRng(CONFIG.world.seed + 101);
        const pos = new Float32Array(count * 3);
        const seed = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const a = rng() * Math.PI * 2;
            const r = Math.sqrt(rng()) * this.focusRadius;
            pos[i * 3] = Math.cos(a) * r;
            pos[i * 3 + 1] = 1 + rng() * 6;
            pos[i * 3 + 2] = Math.sin(a) * r;
            seed[i] = rng() * 100;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
        this.disposal.track(geo);
        const mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new THREE.Color(PALETTE.neonAmber) },
                uNight: { value: 1 },
                uSize: { value: 26 },
            },
            vertexShader: /* glsl */ `
                attribute float aSeed;
                uniform float uTime, uSize;
                varying float vTw;
                void main(){
                    vec3 p = position;
                    p.x += sin(uTime*0.6 + aSeed)*1.6;
                    p.y += sin(uTime*0.9 + aSeed*1.7)*0.8;
                    p.z += cos(uTime*0.5 + aSeed*1.2)*1.6;
                    vTw = 0.5 + 0.5*sin(uTime*3.0 + aSeed*5.0);
                    vec4 mv = modelViewMatrix * vec4(p,1.0);
                    gl_PointSize = uSize * (1.0/-mv.z) * (0.6+vTw);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: /* glsl */ `
                precision highp float;
                uniform vec3 uColor; uniform float uNight;
                varying float vTw;
                void main(){
                    float d = length(gl_PointCoord - 0.5);
                    if (d > 0.5) discard;
                    float glow = smoothstep(0.5, 0.0, d);
                    gl_FragColor = vec4(uColor, glow*vTw*uNight);
                }
            `,
        });
        this.disposal.track(mat);
        this.ffMat = mat;
        this.fireflies = new THREE.Points(geo, mat);
        this.fireflies.frustumCulled = false;
        this.group.add(this.fireflies);
    }

    private buildRain(quality: QualityTier) {
        const count = CONFIG.particles.rainDrops[quality];
        if (count <= 0) return;
        const rng = makeRng(CONFIG.world.seed + 202);
        const pos = new Float32Array(count * 3);
        this.rainVel = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            pos[i * 3] = (rng() - 0.5) * 120;
            pos[i * 3 + 1] = rng() * 40;
            pos[i * 3 + 2] = (rng() - 0.5) * 120;
            this.rainVel[i] = 30 + rng() * 25;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        this.disposal.track(geo);
        const mat = new THREE.PointsMaterial({
            color: 0x9fc3ff,
            size: 0.2,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
        });
        this.disposal.track(mat);
        this.rainMat = mat;
        this.rain = new THREE.Points(geo, mat);
        this.rain.visible = false;
        this.rain.frustumCulled = false;
        this.group.add(this.rain);
    }

    setRain(on: boolean) {
        this.rainOn = on;
        if (this.rain) this.rain.visible = on;
    }

    toggleRain() {
        this.setRain(!this.rainOn);
    }

    get raining() {
        return this.rainOn;
    }

    update(dt: number, elapsed: number, night: number, focus: THREE.Vector3) {
        this.group.position.set(focus.x, 0, focus.z);
        if (this.ffMat) {
            this.ffMat.uniforms.uTime.value = elapsed;
            this.ffMat.uniforms.uNight.value = night;
        }
        if (this.rain && this.rainOn) {
            const arr = this.rain.geometry.attributes.position as THREE.BufferAttribute;
            for (let i = 0; i < this.rainVel.length; i++) {
                let y = arr.getY(i) - this.rainVel[i] * dt;
                if (y < 0) y = 40;
                arr.setY(i, y);
            }
            arr.needsUpdate = true;
        }
    }
}
