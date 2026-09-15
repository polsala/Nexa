import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "nexa-oss-boundary",
      moduleParsed(module) {
        if (/@univerjs-pro[+/]/.test(module.id)) {
          this.error(`Proprietary module cannot be bundled: ${module.id}`);
        }
      },
    },
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/artifacts/**",
        "**/playwright-report/**",
        "**/test-results/**",
        "**/target/**",
        "**/.cache/**",
      ],
    },
  },
  optimizeDeps: {
    include: [
      "@univerjs/preset-sheets-core/worker",
      "@univerjs/core/lib/facade",
    ],
  },
  build: {
    target: ["es2022", "chrome105", "safari15"],
    outDir: "dist",
    // Debug maps are opt-in; do not embed source copies in desktop installers.
    sourcemap: process.env.NEXA_SOURCEMAPS === "1",
  },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});
