"use client";
import { useCallback, useRef, useState } from "react";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokens?: number;
};
export type StreamStatus = "idle" | "streaming" | "done" | "error";

export function useOpenClawChat(sessionKey: string, boardId: string | undefined, agentId?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (text: string, instructions?: string) => {
    if (!boardId || !text.trim()) return;
    setError(null);

    const userId = crypto.randomUUID();
    const asstId = crypto.randomUUID();
    setMessages(p => [
      ...p,
      { id: userId, role: "user", content: text },
      { id: asstId, role: "assistant", content: "" },
    ]);
    setStreamStatus("streaming");
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/v1/gateways/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          board_id: boardId,
          session_key: `agent:main:${sessionKey}`,
          ...(agentId ? { agent_id: agentId } : {}),
          ...(instructions ? { instructions } : {}),
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error("No body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const p = JSON.parse(line.slice(6));
            if (p.error) throw new Error(p.error);
            if (p.delta) {
              setMessages(prev => prev.map(m =>
                m.id === asstId ? { ...m, content: m.content + p.delta } : m
              ));
            }
          } catch (e) {
            if (e instanceof Error && e.name !== "SyntaxError") throw e;
          }
        }
      }
      setStreamStatus("done");
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") { setStreamStatus("idle"); return; }
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStreamStatus("error");
    }
  }, [boardId, sessionKey]);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    setStreamStatus("idle");
  }, []);

  return { messages, streamStatus, error, sendMessage, stopStream };
}
