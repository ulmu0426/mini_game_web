import { notFound } from "next/navigation";
import { getGameBySlug } from "@/data/games";
import { GameFrame } from "./GameFrame";

export default async function GamePage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const game = getGameBySlug(slug);
  if (!game) {
    notFound();
  }

  return (
    <main className="container">
      <h1>{game.title}</h1>
      <p>{game.description}</p>
      <ul>
        {game.controls.map((control) => (
          <li key={control}>{control}</li>
        ))}
      </ul>
      <GameFrame slug={slug} />
    </main>
  );
}
