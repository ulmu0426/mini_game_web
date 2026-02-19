export type GameMeta = {
  slug: "dodge";
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
    description: "Falling obstacles를 피해서 오래 생존하는 간단한 회피 게임",
    controls: ["←/→ 또는 A/D 이동", "모바일: 화면 터치 위치로 이동"],
    tags: ["arcade", "survival", "phaser"],
    thumbnail: "/thumbnails/dodge.png",
    iframePath: "/games/dodge/index.html",
    devUrl: "http://localhost:5173/"
  }
];

export const getGameBySlug = (slug: string) =>
  GAMES.find((game) => game.slug === slug);
