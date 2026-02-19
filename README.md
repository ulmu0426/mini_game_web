# MiniGames Hub

Next.js Hub와 Phaser 게임을 분리한 모노레포입니다.  
게임은 각 앱에서 Vite로 빌드한 뒤 Hub의 `public/games/*`로 동기화하여 같은 도메인에서 서비스합니다.

## Stack

- Package manager: `pnpm`
- Monorepo: `turborepo`
- Hub: `Next.js (App Router) + TypeScript`
- Game: `Phaser 3 + Vite + TypeScript`
- Shared protocol: `packages/sdk` (`postMessage`)

## Run Local

```bash
npm install
npm run dev
```

- Hub: `http://localhost:3000`
- game-dodge(dev): `http://localhost:5173`
- 플레이 URL: `http://localhost:3000/games/dodge`

## Production Build (Local)

```bash
npm --workspace apps/hub run build
npm --workspace apps/hub run start
```

빌드 후 `apps/hub/public/games/dodge/index.html`이 생성되어야 하며,  
`/games/dodge`에서 게임이 동작합니다.

## Add New Game

1. `apps/game-xxx`를 기존 게임 앱을 기준으로 복사/생성
2. `vite.config.ts`에서 `base`를 `"/games/xxx/"`로 설정
3. `scripts/sync-games.mjs`에 `xxx` slug 복사 규칙 추가
4. `apps/hub/src/data/games.ts`에 메타데이터 추가

## Vercel Settings

- Root Directory: `apps/hub`
- Include source files outside of the Root Directory: `ON`
- Build Command: `pnpm build`
- Framework Preset: `Next.js`
- Install Command: `pnpm install` (Auto 가능)
- 권장 환경변수: `ENABLE_EXPERIMENTAL_COREPACK=1`

## Windows Notes

- PowerShell 실행 정책으로 `pnpm`/`npm` 명령이 막히면 `pnpm.cmd`/`npm.cmd`를 사용하세요.
- 바로 실행:
  - 개발: `dev.cmd`
  - 빌드: `build-hub.cmd`
  - 실행: `start-hub.cmd`

## Score Storage

- best score key: `mg:best:<slug>`
- 예: `mg:best:dodge`
