import GUI from "lil-gui";
import Stats from "stats.js";
import { CONFIG } from "./Config";

/** lil-gui + stats.js panel, only built when the URL has ?debug. */
export class Debug {
    static active() {
        return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");
    }

    private gui?: GUI;
    private stats?: Stats;

    constructor(hooks: {
        onQuality: (q: "low" | "medium" | "high") => void;
        onTimeScrub: (t: number) => void;
        onToggleRain: () => void;
    }) {
        this.gui = new GUI({ title: "Èkó Nights · debug" });
        this.stats = new Stats();
        this.stats.showPanel(0);
        this.stats.dom.style.cssText = "position:fixed;top:0;left:0;z-index:9999";
        document.body.appendChild(this.stats.dom);

        const env = this.gui.addFolder("Environment");
        const state = { dayTime: CONFIG.dayNight.start, quality: "high" as const };
        env.add(state, "dayTime", 0, 1, 0.01).name("Time of day").onChange(hooks.onTimeScrub);
        env.add({ rain: hooks.onToggleRain }, "rain").name("Toggle rain");

        const q = this.gui.addFolder("Quality");
        q.add({ q: "high" }, "q", ["low", "medium", "high"])
            .name("Tier")
            .onChange((v: "low" | "medium" | "high") => hooks.onQuality(v));

        const veh = this.gui.addFolder("Vehicle");
        veh.add(CONFIG.vehicle, "enginePower", 10, 120, 1);
        veh.add(CONFIG.vehicle, "maxSpeed", 20, 120, 1);
        veh.add(CONFIG.vehicle, "grip", 1, 20, 0.1);
        veh.add(CONFIG.vehicle, "steerMax", 0.1, 1, 0.01);
        veh.close();

        const cam = this.gui.addFolder("Camera");
        cam.add(CONFIG.camera.follow, "distance", 5, 30, 0.5);
        cam.add(CONFIG.camera.follow, "height", 2, 15, 0.5);
        cam.add(CONFIG.camera.follow, "stiffness", 1, 12, 0.1);
        cam.close();
    }

    begin() {
        this.stats?.begin();
    }
    end() {
        this.stats?.end();
    }

    dispose() {
        this.gui?.destroy();
        if (this.stats?.dom.parentElement) this.stats.dom.parentElement.removeChild(this.stats.dom);
    }
}
