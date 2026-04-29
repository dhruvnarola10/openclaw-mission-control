"use client";
import { useCallback, useRef, useState } from "react";

// ── Gateway coordinates read from public env vars ─────────────────────────────
// Set in frontend/.env.local:
//   NEXT_PUBLIC_OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
//   NEXT_PUBLIC_OPENCLAW_GATEWAY_TOKEN=<your token>
const GATEWAY_BASE =
  (process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789").replace(/\/$/, "");
const GATEWAY_TOKEN = process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_TOKEN ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type StreamStatus = "idle" | "streaming" | "done" | "error";

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Calls the OpenClaw gateway /v1/responses SSE endpoint directly from the
 * browser, exactly like:
 *
 *   curl -N http://127.0.0.1:18789/v1/responses
 *     -H 'Authorization: Bearer <NEXT_PUBLIC_OPENCLAW_GATEWAY_TOKEN>'
 *     -H 'Content-Type: application/json'
 *     -H 'x-openclaw-agent-id: main'
 *     -d '{ "model": "openclaw", "stream": true, "input": "hi" }'
 */
export function useGatewaySSEChat(sessionKey: string) {
  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [streamStatus, setStatus]   = useState<StreamStatus>("idle");
  const [error, setError]           = useState<string | null>(null);
  const abortRef                    = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setError(null);

      const userId = crypto.randomUUID();
      const asstId = crypto.randomUUID();

      // Optimistic bubbles
      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user",      content: text },
        { id: asstId, role: "assistant", content: "" },
      ]);
      setStatus("streaming");
      abortRef.current = new AbortController();

      try {
        const res = await fetch(`${GATEWAY_BASE}/v1/responses`, {
          method: "POST",
          headers: {
            "Content-Type":        "application/json",
            "Authorization":       `Bearer ${GATEWAY_TOKEN}`,
            "x-openclaw-agent-id": "main",
          },
          body: JSON.stringify({
            model:  "openclaw",
            stream: true,
            input:  text,
            user:   sessionKey, // ties this request to the session
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const detail = await res.text();
          throw new Error(`Gateway ${res.status}: ${detail}`);
        }
        if (!res.body) throw new Error("No response body from gateway");

        // ── SSE streaming ────────────────────────────────────────────────────
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
            // Track event type line (OpenAI Responses API)
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
              continue;
            }

            if (!line.startsWith("data: ")) continue;

            const raw = line.slice(6).trim();

            // Legacy chat-completions [DONE] sentinel
            if (raw === "[DONE]") {
              setStatus("done");
              return;
            }

            try {
              const p = JSON.parse(raw) as Record<string, unknown>;

              if (p.error) throw new Error(String(p.error));

              // OpenAI Responses API completion events
              if (
                p.type === "response.completed" ||
                p.type === "response.done"       ||
                currentEvent === "response.completed"
              ) {
                setStatus("done");
                return;
              }

              // Extract delta text — handles all three SSE formats:
              //   OpenAI Responses API : { type:"response.output_text.delta", delta:"…" }
              //   OpenAI Chat Compl.   : { choices:[{ delta:{ content:"…" } }] }
              //   Normalized           : { delta:"…" }
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
              // Re-throw real errors; swallow JSON parse noise
              if (e instanceof Error && e.name !== "SyntaxError") throw e;
            }

            currentEvent = ""; // reset after consuming its data line
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
        // Drop the empty assistant bubble so UI doesn't show a blank bubble
        setMessages((prev) => prev.filter((m) => m.id !== asstId));
      }
    },
    [sessionKey],
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
