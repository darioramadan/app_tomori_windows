import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, fs: { allow: ["..", "."] } },
  // site/ has its own tsconfig (astro preset) that is not resolvable from here
  esbuild: { tsconfigRaw: "{}" },
  base: "./", // loaded from file:// by Electron
  build: { target: "chrome120" },
});
