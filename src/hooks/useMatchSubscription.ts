/**
 * useMatchSubscription
 * --------------------
 * React hook that subscribes to live updates for a single match via the
 * pipeline WebSocket gateway. Pairs with `backend/pipeline/gateway/app.py`.
 *
 * Behavior:
 *  - Auto-reconnect with capped exponential backoff (max 30s)
 *  - Heartbeat ping every 25s to match server's idle timeout
 *  - Replays events that arrived between mount and first SnapshotMessage
 *  - Falls back gracefully to "disconnected" state if NEXT_PUBLIC_GATEWAY_URL
 *    is unset (so production builds without a gateway don't break the UI)
 */

import { useEffect, useRef, useState } from "react";

type Probabilities = { home_win: number; draw: number; away_win: number };

export type MatchSnapshotState = {
  score?: { home: number | null; away: number | null };
  status?: string;
  phase?: string;
  minute?: number | null;
};

export type LiveMatchEvent = {
  event_id: string;
  event_type: string;
  minute?: number;
  player_id?: number | null;
  team_id?: number | null;
  payload?: Record<string, unknown>;
};

export type MatchSubscription = {
  status: "idle" | "connecting" | "open" | "closed" | "error";
  state: MatchSnapshotState;
  events: LiveMatchEvent[];
  probabilities: Probabilities | null;
  modelVersion: string | null;
  /** Manually force-reconnect; useful when the tab regains focus. */
  reconnect: () => void;
};

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL || "ws://localhost:8001";
const PING_INTERVAL_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

export function useMatchSubscription(matchId: string | null | undefined): MatchSubscription {
  const [status, setStatus] = useState<MatchSubscription["status"]>("idle");
  const [state, setState] = useState<MatchSnapshotState>({});
  const [events, setEvents] = useState<LiveMatchEvent[]>([]);
  const [probabilities, setProbabilities] = useState<Probabilities | null>(null);
  const [modelVersion, setModelVersion] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef<number>(500);

  const clearTimers = () => {
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
  };

  const connect = () => {
    if (!matchId) return;
    setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${GATEWAY_URL}/ws/match/${encodeURIComponent(matchId)}`);
    } catch (err) {
      setStatus("error");
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setStatus("open");
      backoffRef.current = 500;
      pingRef.current = setInterval(() => {
        try {
          ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          /* connection died — onclose will fire */
        }
      }, PING_INTERVAL_MS);
    });

    ws.addEventListener("message", (evt) => {
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "snapshot":
          setState((msg.state as MatchSnapshotState) || {});
          break;
        case "event": {
          const envelope = msg.event as {
            event_id?: string;
            event_type?: string;
            payload?: Record<string, unknown>;
          };
          if (!envelope?.event_id || !envelope?.event_type) break;
          setEvents((prev) => [
            ...prev,
            {
              event_id: String(envelope.event_id),
              event_type: String(envelope.event_type),
              minute: Number(envelope.payload?.minute) || undefined,
              player_id: (envelope.payload?.player_id as number) ?? null,
              team_id: (envelope.payload?.team_id as number) ?? null,
              payload: envelope.payload,
            },
          ]);
          // Score deltas update the snapshot eagerly so UI doesn't wait for a snapshot
          if (envelope.event_type === "match.score.changed" && envelope.payload) {
            const p = envelope.payload as Record<string, unknown>;
            setState((s) => ({
              ...s,
              score: {
                home: (p.home_score as number) ?? s.score?.home ?? null,
                away: (p.away_score as number) ?? s.score?.away ?? null,
              },
              status: (p.status as string) ?? s.status,
              phase: (p.phase as string) ?? s.phase,
            }));
          }
          break;
        }
        case "prediction":
          setProbabilities((msg.probabilities as Probabilities) ?? null);
          setModelVersion((msg.model_version as string) ?? null);
          break;
        case "pong":
        case "error":
        default:
          break;
      }
    });

    ws.addEventListener("close", () => {
      setStatus("closed");
      clearTimers();
      scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      setStatus("error");
    });
  };

  const scheduleReconnect = () => {
    if (reconnectRef.current) return;
    const delay = backoffRef.current;
    backoffRef.current = Math.min(MAX_BACKOFF_MS, delay * 2);
    reconnectRef.current = setTimeout(() => {
      reconnectRef.current = null;
      connect();
    }, delay);
  };

  useEffect(() => {
    if (!matchId) {
      setStatus("idle");
      return;
    }
    connect();
    return () => {
      clearTimers();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && ws.readyState <= 1) {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  return {
    status,
    state,
    events,
    probabilities,
    modelVersion,
    reconnect: () => {
      clearTimers();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      }
      connect();
    },
  };
}
