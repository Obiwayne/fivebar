import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { "cli/index": "src/cli/index.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    outDir: "dist",
    sourcemap: true,
    clean: false,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: { "app/main": "src/app/main.ts" },
    format: ["esm"],
    platform: "node",
    target: "node20",
    outDir: "dist",
    sourcemap: true,
    clean: false,
    external: ["electron"],
  },
]);
