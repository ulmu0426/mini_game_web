import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, "..");
const distDir = path.join(appDir, "dist");
const assetsDir = path.join(distDir, "assets");

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(assetsDir, { recursive: true });

await build({
  entryPoints: [path.join(appDir, "src", "main.ts")],
  bundle: true,
  format: "esm",
  target: ["es2022"],
  outfile: path.join(assetsDir, "index.js"),
  sourcemap: false,
  minify: false
});

const htmlPath = path.join(appDir, "index.html");
let html = await fs.readFile(htmlPath, "utf8");
html = html.replace(
  '<script type="module" src="/src/main.ts"></script>',
  '<script type="module" src="./assets/index.js"></script>'
);
await fs.writeFile(path.join(distDir, "index.html"), html, "utf8");

console.log("Built game-tetris dist via esbuild");
