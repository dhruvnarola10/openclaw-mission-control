"use client";
import { useCallback, useRef, useState, useEffect } from "react";
import { useAuth } from "@/auth/clerk";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokens?: number;
};
export type StreamStatus = "idle" | "streaming" | "done" | "error";

export function useOpenClawChat(
  sessionKey: string,
  boardId: string | undefined,
  agentId?: string
) {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Note: I kept the history fetching logic so your old messages still load!
  useEffect(() => {
    if (!boardId || !sessionKey) {
      setMessages([]);
      return;
    }
    
    setStreamStatus("idle");
    setError(null);
    
    const fetchHistory = async () => {
      try {
        const token = await getToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        const res = await fetch(`/api/v1/gateways/chat/sessions/${encodeURIComponent(sessionKey)}/history?board_id=${boardId}`, { headers });
        if (!res.ok) throw new Error("Failed to fetch history");
        const data = await res.json();
        const historyData = data.history || data.messages;
        if (historyData && Array.isArray(historyData)) {
          const formattedHistory: ChatMessage[] = historyData.map((msg: any) => ({
            id: String(msg.id || crypto.randomUUID()),
            role: (msg.role === "user" ? "user" : "assistant") as "user" | "assistant",
            content: String(msg.content || msg.text || ""),
            tokens: msg.tokens ? Number(msg.tokens) : undefined,
          }));
          setMessages(formattedHistory);
        } else {
          setMessages([]);
        }
      } catch (err: any) {
        console.error("Error fetching history:", err);
        setMessages([]);
      }
    };
    
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, sessionKey]);

  const sendMessage = useCallback(
    async (text: string, instructions?: string) => {
      if (!boardId || !text.trim()) return;
      setError(null);

      const token = await getToken();
      const userId = crypto.randomUUID();
      const asstId = crypto.randomUUID();
      setMessages((p) => [
        ...p,
        { id: userId, role: "user", content: text },
        { id: asstId, role: "assistant", content: "" },
      ]);
      setStreamStatus("streaming");
      abortRef.current = new AbortController();

      try {
        const res = await fetch("/api/v1/chat/stream", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            message: text,
            board_id: boardId,
            session_key: sessionKey,
            ...(agentId ? { agent_id: agentId } : {}),
            ...(instructions ? { instructions } : {}),
            // Inject gateway credentials from public env vars when available.
            // This lets the backend authenticate even if the board DB config
            // does not have the token saved yet.
            ...(process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_TOKEN
              ? { gateway_token: process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_TOKEN }
              : {}),
            ...(process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_URL
              ? { gateway_url: process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_URL }
              : {}),
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const detail = await res.text();
          throw new Error(`HTTP ${res.status}: ${detail}`);
        }
        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let currentEvent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            // Track SSE event type (e.g. "event: response.output_text.delta")
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
              continue;
            }

            if (!line.startsWith("data: ")) continue;

            const raw = line.slice(6).trim();

            // Legacy [DONE] sentinel (chat-completions style)
            if (raw === "[DONE]") {
              setStreamStatus("done");
              return;
            }

            try {
              const p = JSON.parse(raw);
              if (p.error) throw new Error(p.error);

              // OpenAI Responses API — stream finished
              if (
                p.type === "response.completed" ||
                p.type === "response.done" ||
                currentEvent === "response.completed"
              ) {
                setStreamStatus("done");
                return;
              }

              // Extract delta text — handles:
              //   OpenAI Responses API: { type:"response.output_text.delta", delta:"…" }
              //   OpenAI Chat Completions: { choices:[{ delta:{ content:"…" } }] }
              //   Our normalized SSE:  { delta:"…" }
              const delta =
                (p.type === "response.output_text.delta" ? p.delta : undefined) ??
                p.delta ??
                p.choices?.[0]?.delta?.content ??
                p.choices?.[0]?.text ??
                "";

              if (delta) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === asstId
                      ? { ...m, content: m.content + delta }
                      : m
                  )
                );
              }
            } catch (e) {
              if (e instanceof Error && e.name !== "SyntaxError") throw e;
            }

            // Reset event name after processing its data line
            currentEvent = "";
          }
        }
        setStreamStatus("done");
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") {
          setStreamStatus("idle");
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStreamStatus("error");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardId, sessionKey, agentId]
  );

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    setStreamStatus("idle");
  }, []);

  return { messages, streamStatus, error, sendMessage, stopStream };
}
