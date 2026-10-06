import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Only the v3 world's pure-logic tests run here (Layout invariants, math,
// fonts coverage, physics interpolation). v2 has no tests.
export default defineConfig({
    resolve: {
        alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) }],
    },
    test: {
        include: ["app/components/three/world3/**/*.test.ts"],
        environment: "node",
    },
});
