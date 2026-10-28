import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The renderer is plain React. In development it talks to `fivebar serve` on port 4870.
export default defineConfig({
  root: "src/app/renderer",
  base: "./",
  plugins: [react()],
  build: { outDir: "../../../dist/ui", emptyOutDir: true },
  server: {
    port: 4871,
    proxy: { "/api": "http://127.0.0.1:4870" },
  },
});
