import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: "dist-electron",
    sourcemap: true,
    ssr: true,
    target: "node22",
    rollupOptions: {
      external: ["electron"],
      input: {
        apiChild: "src/electron/api-child.ts",
        main: "src/electron/main.ts",
        preload: "src/electron/preload.ts",
      },
      output: {
        chunkFileNames: "chunks/[name]-[hash].cjs",
        entryFileNames: "[name].cjs",
        format: "cjs",
      },
    },
  },
});
