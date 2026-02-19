"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createHubMessenger } from "@minigame/sdk";
import { getGameBySlug } from "@/data/games";

const getBestKey = (slug: string) => `mg:best:${slug}`;

export function GameFrame({ slug }: { slug: string }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const game = getGameBySlug(slug);

  const src = useMemo(() => {
    if (!game) {
      return "";
    }
    return process.env.NODE_ENV === "development" ? game.devUrl : game.iframePath;
  }, [game]);

  useEffect(() => {
    const key = getBestKey(slug);
    const raw = localStorage.getItem(key);
    const parsed = raw ? Number(raw) : 0;
    setBest(Number.isFinite(parsed) ? parsed : 0);
  }, [slug]);

  useEffect(() => {
    const keys = new Set([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
    const onKeyDown = (event: KeyboardEvent) => {
      if (keys.has(event.key)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!iframeRef.current) {
      return;
    }

    const allowedOrigins =
      process.env.NODE_ENV === "development"
        ? ["http://localhost:5173"]
        : [window.location.origin];

    const messenger = createHubMessenger(iframeRef.current, allowedOrigins);

    messenger.onReady(() => {
      setIsReady(true);
      messenger.postInit({
        gameSlug: slug,
        muted: false,
        locale: navigator.language || "ko-KR"
      });
    });

    messenger.onSubmitScore(({ score: submitted, gameSlug }) => {
      if (gameSlug !== slug) {
        return;
      }
      const safeScore = Math.max(0, Math.floor(submitted));
      setScore(safeScore);
      setBest((prev) => {
        const nextBest = Math.max(prev, safeScore);
        localStorage.setItem(getBestKey(slug), String(nextBest));
        return nextBest;
      });
    });

    return () => messenger.dispose();
  }, [slug]);

  if (!game) {
    return <p>게임 메타를 찾을 수 없습니다.</p>;
  }

  return (
    <section>
      <p>
        상태: {isReady ? "READY" : "LOADING"} | 현재 점수: {score} | 최고 점수: {best}
      </p>
      <div
        className="frame-wrap"
        onClick={() => iframeRef.current?.focus()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            iframeRef.current?.focus();
          }
        }}
      >
        <iframe
          ref={iframeRef}
          title={game.title}
          src={src}
          allow="autoplay; fullscreen; gamepad"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </section>
  );
}
