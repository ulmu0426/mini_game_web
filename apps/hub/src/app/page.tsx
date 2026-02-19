import Link from "next/link";
import { GAMES } from "@/data/games";

export default function HomePage() {
  return (
    <main className="container">
      <h1>MiniGames Hub</h1>
      <p>간단한 2D 캐주얼 게임을 실행하는 허브입니다.</p>
      <div className="card-grid">
        {GAMES.map((game) => (
          <article key={game.slug} className="card">
            <img
              src={game.thumbnail}
              alt={game.title}
              width={640}
              height={360}
              style={{ display: "block", width: "100%", height: "auto" }}
            />
            <div className="card-body">
              <h2>{game.title}</h2>
              <p>{game.description}</p>
              <div className="tag-list">
                {game.tags.map((tag) => (
                  <span className="tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <p>
                <Link href={`/games/${game.slug}`}>플레이하기</Link>
              </p>
            </div>
          </article>
        ))}
      </div>
      <p style={{ marginTop: 18 }}>
        <Link href="/privacy">개인정보/광고 안내</Link>
      </p>
    </main>
  );
}
