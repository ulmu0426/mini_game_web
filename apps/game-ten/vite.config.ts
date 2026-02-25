import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/games/ten/" : "/",
  resolve: {
    alias: {
      "@minigame/sdk": path.resolve(__dirname, "../../packages/sdk/src/index.ts")
    }
  }
}));
