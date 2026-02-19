import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/games/dodge/" : "/",
  build: {
    minify: false
  },
  resolve: {
    alias: {
      "@minigame/sdk": path.resolve(__dirname, "../../packages/sdk/src/index.ts")
    }
  }
}));
