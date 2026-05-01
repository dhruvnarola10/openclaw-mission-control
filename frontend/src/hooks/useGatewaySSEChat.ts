"use client";
import { useCallback, useRef, useState } from "react";

// Gateway credentials from env vars — baked at build time by Next.js.
const GATEWAY_URL   = process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_URL   ?? "";
const GATEWAY_TOKEN = process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_TOKEN ?? "";

const API_BASE =
  typeof window !== "undefined"
    ? ""
    : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000");

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type StreamStatus = "idle" | "streaming" | "done" | "error";

/**
 * Calls POST /api/v1/gateways/chat/responses on the MC backend.
 * The backend proxies to the OpenClaw gateway /v1/responses and streams
 * SSE back — no CORS issues, gateway token stays server-side.
 */
export function useGatewaySSEChat(params: {
  sessionKey: string;
  agentId?: string;
}) {
  const { sessionKey, agentId } = params;

  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [streamStatus, setStatus] = useState<StreamStatus>("idle");
  const [error, setError]         = useState<string | null>(null);
  const abortRef                  = useRef<AbortController | null>(null);

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
        const res = await fetch(`${API_BASE}/api/v1/gateways/chat/responses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message:       text,
            session_key:   sessionKey,
            agent_id:      agentId ?? "main",
            gateway_url:   GATEWAY_URL,
            gateway_token: GATEWAY_TOKEN,
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
