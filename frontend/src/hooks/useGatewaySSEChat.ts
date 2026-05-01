"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import { getApiBaseUrl } from "@/lib/api-base";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type StreamStatus = "idle" | "streaming" | "done" | "error";

export type SessionMeta = {
  key: string;
  preview: string;
  updatedAt: number;
};

const SESSIONS_LS_KEY = "ochat_sessions";

function getStorageKey(sessionKey: string) {
  return `ochat_msgs_${sessionKey}`;
}

function loadMessages(sessionKey: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getStorageKey(sessionKey));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch { return []; }
}

function persistMessages(sessionKey: string, msgs: ChatMessage[]) {
  if (typeof window === "undefined" || msgs.length === 0) return;
  try {
    localStorage.setItem(getStorageKey(sessionKey), JSON.stringify(msgs));
    const raw = localStorage.getItem(SESSIONS_LS_KEY);
    const sessions: SessionMeta[] = raw ? JSON.parse(raw) : [];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    const preview = lastUser ? lastUser.content.slice(0, 60) : "";
    const meta: SessionMeta = { key: sessionKey, preview, updatedAt: Date.now() };
    const filtered = sessions.filter((s) => s.key !== sessionKey);
    localStorage.setItem(SESSIONS_LS_KEY, JSON.stringify([meta, ...filtered].slice(0, 20)));
  } catch { /* ignore quota/parse errors */ }
}

export function loadSessions(): SessionMeta[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SESSIONS_LS_KEY);
    return raw ? (JSON.parse(raw) as SessionMeta[]) : [];
  } catch { return []; }
}

/**
 * Calls POST /api/v1/gateways/chat/responses on the MC backend.
 * The backend proxies to the OpenClaw gateway /v1/responses and streams
 * SSE back — no CORS issues, gateway token stays server-side.
 * Messages are persisted to localStorage keyed by sessionKey.
 */
export function useGatewaySSEChat(params: {
  sessionKey: string;
  agentId?: string;
}) {
  const { sessionKey, agentId } = params;

  const [messages, setMessages]   = useState<ChatMessage[]>(() => loadMessages(sessionKey));
  const [streamStatus, setStatus] = useState<StreamStatus>("idle");
  const [error, setError]         = useState<string | null>(null);
  const abortRef                  = useRef<AbortController | null>(null);

  // Reload from localStorage whenever sessionKey changes (e.g. restore old session)
  useEffect(() => {
    setMessages(loadMessages(sessionKey));
    setError(null);
    setStatus("idle");
  }, [sessionKey]);

  // Persist non-empty message lists to localStorage
  useEffect(() => {
    persistMessages(sessionKey, messages);
  }, [messages, sessionKey]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setError(null);

      const userId = crypto.randomUUID();
      const asstId = crypto.randomUUID();

      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user",      content: text },
        { id: asstId, role: "assistant", content: "" },
      ]);
      setStatus("streaming");
      abortRef.current = new AbortController();

      try {
        const res = await fetch(`${getApiBaseUrl()}/api/v1/gateways/chat/responses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message:     text,
            session_key: sessionKey,
            agent_id:    agentId ?? "main",
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const detail = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error((detail as { detail?: string }).detail ?? `Request failed: ${res.status}`);
        }
        if (!res.body) throw new Error("No response body");

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let buf          = "";
        let currentEvent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
              continue;
            }
            if (!line.startsWith("data: ")) continue;

            const raw = line.slice(6).trim();
            if (raw === "[DONE]") { setStatus("done"); return; }

            try {
              const p = JSON.parse(raw) as Record<string, unknown>;

              if (p.error) throw new Error(String(p.error));

              if (
                p.type === "response.completed" ||
                p.type === "response.done"       ||
                currentEvent === "response.completed"
              ) {
                setStatus("done");
                return;
              }

              const delta =
                (p.type === "response.output_text.delta" ? (p.delta as string) : undefined) ??
                (p.delta as string | undefined)                                               ??
                (p.choices as any)?.[0]?.delta?.content                                      ??
                "";

              if (delta) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === asstId ? { ...m, content: m.content + delta } : m,
                  ),
                );
              }
            } catch (e) {
              if (e instanceof Error && e.name !== "SyntaxError") throw e;
            }

            currentEvent = "";
          }
        }

        setStatus("done");
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") { setStatus("idle"); return; }
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus("error");
        setMessages((prev) => prev.filter((m) => m.id !== asstId));
      }
    },
    [sessionKey, agentId],
  );

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
  }, []);

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStatus("idle");
  }, []);

  return { messages, streamStatus, error, sendMessage, stopStream, clearMessages };
}
