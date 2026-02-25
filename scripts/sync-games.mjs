import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const games = [
  {
    slug: "dodge",
    src: path.join(rootDir, "apps", "game-dodge", "dist"),
    dest: path.join(rootDir, "apps", "hub", "public", "games", "dodge")
  },
  {
    slug: "tetris",
    src: path.join(rootDir, "apps", "game-tetris", "dist"),
    dest: path.join(rootDir, "apps", "hub", "public", "games", "tetris")
  },
  {
    slug: "ten",
    src: path.join(rootDir, "apps", "game-ten", "dist"),
    dest: path.join(rootDir, "apps", "hub", "public", "games", "ten")
  }
];

const ensureCleanDir = async (dirPath) => {
  await fs.rm(dirPath, { recursive: true, force: true });
  await fs.mkdir(dirPath, { recursive: true });
};

const copyDirRecursive = async (src, dest) => {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
};

const run = async () => {
  for (const game of games) {
    await ensureCleanDir(game.dest);
    await copyDirRecursive(game.src, game.dest);
    console.log(`Synced ${game.slug}: ${game.src} -> ${game.dest}`);
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
