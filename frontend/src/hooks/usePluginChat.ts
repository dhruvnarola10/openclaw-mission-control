"use client";

import { useCallback, useRef, useState } from "react";
import { getApiBaseUrl } from "@/lib/api-base";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type StreamStatus = "idle" | "streaming" | "done" | "error";

/**
 * Chat hook that routes messages through the MC backend plugin-chat bridge
 * instead of hitting the OpenClaw gateway directly.
 *
 * Flow:
 *   sendMessage() → POST /api/v1/plugin-chat/send  → OpenClaw plugin
 *   SSE stream    ← GET  /api/v1/plugin-chat/stream/{requestId}
 *   reply arrives ← POST /api/v1/plugin-chat/reply (from plugin → MC backend → SSE)
 */
export function usePluginChat(params: {
  boardId: string;
  sessionKey: string;
  agentId?: string;
  authToken?: string;
}) {
  const { boardId, sessionKey, agentId, authToken } = params;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamStatus, setStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const buildHeaders = (): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) h["Authorization"] = `Bearer ${authToken}`;
    return h;
  };

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !boardId) return;
      setError(null);

      const userId = crypto.randomUUID();
      const asstId = crypto.randomUUID();

      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", content: text },
        { id: asstId, role: "assistant", content: "" },
      ]);
      setStatus("streaming");
      abortRef.current = new AbortController();

      try {
        // 1. Forward message to OpenClaw via plugin bridge
        const sendResp = await fetch(`${getApiBaseUrl()}/api/v1/plugin-chat/send`, {
          method: "POST",
          headers: buildHeaders(),
          body: JSON.stringify({
            message: text,
            board_id: boardId,
            session_key: sessionKey,
            agent_id: agentId ?? "main",
          }),
          signal: abortRef.current.signal,
        });

        if (!sendResp.ok) {
          const detail = await sendResp.json().catch(() => ({ detail: sendResp.statusText }));
          throw new Error((detail as { detail?: string }).detail ?? `Send failed: ${sendResp.status}`);
        }

        const { requestId } = (await sendResp.json()) as { requestId: string };

        // 2. Open SSE stream to receive the reply
        const streamResp = await fetch(`${getApiBaseUrl()}/api/v1/plugin-chat/stream/${requestId}`, {
          headers: buildHeaders(),
          signal: abortRef.current.signal,
        });

        if (!streamResp.ok || !streamResp.body) {
          throw new Error(`Stream failed: ${streamResp.status}`);
        }

        const reader = streamResp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();

            if (raw === "[DONE]" || raw === "[TIMEOUT]") {
              setStatus("done");
              return;
            }

            try {
              const parsed = JSON.parse(raw) as { text?: string };
              if (parsed.text) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === asstId ? { ...m, content: parsed.text! } : m,
                  ),
                );
              }
            } catch {
              // skip unparseable lines
            }
          }
        }

        setStatus("done");
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") {
          setStatus("idle");
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus("error");
        setMessages((prev) => prev.filter((m) => m.id !== asstId));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardId, sessionKey, agentId, authToken],
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
