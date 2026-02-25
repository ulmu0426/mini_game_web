export type GameMeta = {
  slug: "dodge" | "tetris" | "ten";
  title: string;
  description: string;
  controls: string[];
  tags: string[];
  thumbnail: string;
  iframePath: string;
  devUrl: string;
};

export const GAMES: GameMeta[] = [
  {
    slug: "dodge",
    title: "Dodge",
    description: "Survive by avoiding falling obstacles.",
    controls: ["Move with Arrow keys or A/D", "Mouse movement is also supported"],
    tags: ["arcade", "survival", "phaser"],
    thumbnail: "/thumbnails/dodge.png",
    iframePath: "/games/dodge/index.html",
    devUrl: "http://localhost:5173/"
  },
  {
    slug: "tetris",
    title: "Tetris",
    description: "Clear lines by stacking blocks efficiently.",
    controls: ["Arrow keys to move", "Up to rotate", "Down to soft drop", "Space to hard drop"],
    tags: ["puzzle", "arcade", "phaser"],
    thumbnail: "/thumbnails/tetris.svg",
    iframePath: "/games/tetris/index.html",
    devUrl: "http://localhost:5174/"
  },
  {
    slug: "ten",
    title: "Make Ten Grid",
    description: "Pick two cells, make a rectangle sum of 10, and clear blocks fast.",
    controls: [
      "First click: start cell",
      "Second click: end cell",
      "If rectangle sum is 10, all included blocks are removed"
    ],
    tags: ["puzzle", "numbers", "strategy"],
    thumbnail: "/thumbnails/ten.svg",
    iframePath: "/games/ten/index.html",
    devUrl: "http://localhost:5175/"
  }
];

export const getGameBySlug = (slug: string) =>
  GAMES.find((game) => game.slug === slug);
