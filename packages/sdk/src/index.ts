export type MgMsg<TType extends string, TPayload> = {
  __mg: 1;
  v: 1;
  type: TType;
  payload: TPayload;
};

export type GameReadyPayload = { gameSlug: string };
export type SubmitScorePayload = {
  gameSlug: string;
  score: number;
  mode?: string;
  runId?: string;
};
export type HubInitPayload = { gameSlug: string; muted: boolean; locale: string };

type AnyMgMsg = MgMsg<string, unknown>;

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
};

export const isMgEnvelope = (data: unknown): data is AnyMgMsg => {
  const body = asRecord(data);
  if (!body) {
    return false;
  }
  return body.__mg === 1 && body.v === 1 && typeof body.type === "string";
};

const isString = (value: unknown): value is string => typeof value === "string";
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isGameReadyPayload = (payload: unknown): payload is GameReadyPayload => {
  const body = asRecord(payload);
  return !!body && isString(body.gameSlug);
};

const isSubmitScorePayload = (payload: unknown): payload is SubmitScorePayload => {
  const body = asRecord(payload);
  if (!body || !isString(body.gameSlug) || !isFiniteNumber(body.score)) {
    return false;
  }
  if (body.mode !== undefined && !isString(body.mode)) {
    return false;
  }
  if (body.runId !== undefined && !isString(body.runId)) {
    return false;
  }
  return true;
};

const isHubInitPayload = (payload: unknown): payload is HubInitPayload => {
  const body = asRecord(payload);
  return (
    !!body &&
    isString(body.gameSlug) &&
    typeof body.muted === "boolean" &&
    isString(body.locale)
  );
};

const envelope = <TType extends string, TPayload>(
  type: TType,
  payload: TPayload
): MgMsg<TType, TPayload> => ({
  __mg: 1,
  v: 1,
  type,
  payload
});

export const createGameMessenger = (targetWindow: Window, targetOrigin: string) => {
  const post = <TType extends string, TPayload>(type: TType, payload: TPayload) => {
    targetWindow.postMessage(envelope(type, payload), targetOrigin);
  };

  return {
    ready(gameSlug: string) {
      post("GAME_READY", { gameSlug } satisfies GameReadyPayload);
    },
    submitScore(payload: SubmitScorePayload) {
      post("SUBMIT_SCORE", payload);
    },
    onInit(handler: (payload: HubInitPayload) => void) {
      const listener = (event: MessageEvent) => {
        if (event.origin !== targetOrigin) {
          return;
        }
        if (!isMgEnvelope(event.data)) {
          return;
        }
        if (event.data.type !== "HUB_INIT") {
          return;
        }
        if (!isHubInitPayload(event.data.payload)) {
          return;
        }
        handler(event.data.payload);
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    }
  };
};

export const createHubMessenger = (
  iframeEl: HTMLIFrameElement,
  allowedOrigins: string[]
) => {
  const listeners: Array<() => void> = [];

  const fromAllowedOrigin = (origin: string) => allowedOrigins.includes(origin);
  const fromGameFrame = (source: MessageEventSource | null) =>
    source === iframeEl.contentWindow;

  return {
    postInit(payload: HubInitPayload) {
      if (!iframeEl.contentWindow) {
        return;
      }
      const msg = envelope("HUB_INIT", payload);
      for (const origin of allowedOrigins) {
        iframeEl.contentWindow.postMessage(msg, origin);
      }
    },
    onReady(handler: (payload: GameReadyPayload) => void) {
      const listener = (event: MessageEvent) => {
        if (!fromAllowedOrigin(event.origin) || !fromGameFrame(event.source)) {
          return;
        }
        if (!isMgEnvelope(event.data) || event.data.type !== "GAME_READY") {
          return;
        }
        if (!isGameReadyPayload(event.data.payload)) {
          return;
        }
        handler(event.data.payload);
      };
      window.addEventListener("message", listener);
      listeners.push(() => window.removeEventListener("message", listener));
    },
    onSubmitScore(handler: (payload: SubmitScorePayload) => void) {
      const listener = (event: MessageEvent) => {
        if (!fromAllowedOrigin(event.origin) || !fromGameFrame(event.source)) {
          return;
        }
        if (!isMgEnvelope(event.data) || event.data.type !== "SUBMIT_SCORE") {
          return;
        }
        if (!isSubmitScorePayload(event.data.payload)) {
          return;
        }
        handler(event.data.payload);
      };
      window.addEventListener("message", listener);
      listeners.push(() => window.removeEventListener("message", listener));
    },
    dispose() {
      for (const off of listeners) {
        off();
      }
      listeners.length = 0;
    }
  };
};
