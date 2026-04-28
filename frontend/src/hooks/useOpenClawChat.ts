"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type ChatMessage = {
  id:      string;
  role:    "user" | "assistant";
  content: string;
  tokens?: number;
};
export type StreamStatus = "idle" | "streaming" | "done" | "error";

export function useOpenClawChat(sessionKey: string, boardId: string, agentId?: string) {
  const [messages,      setMessages]     = useState<ChatMessage[]>([]);
  const [streamStatus,  setStreamStatus] = useState<StreamStatus>("idle");
  const [error,         setError]        = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMessages([]);
    setError(null);
    setStreamStatus("idle");
  }, [boardId]);

  const sendMessage = useCallback(async (text: string, instructions?: string) => {
    if (!boardId || !text.trim()) return;
    setError(null);

    const userId = crypto.randomUUID();
    const asstId = crypto.randomUUID();
    setMessages(p => [
      ...p,
      { id: userId, role: "user",      content: text },
      { id: asstId, role: "assistant", content: ""   },
    ]);
    setStreamStatus("streaming");
    abortRef.current = new AbortController();

    try {
      const token = typeof window !== 'undefined' ? window.sessionStorage.getItem('mc_local_auth_token') : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch("/api/v1/gateways/chat/stream", {
        method:  "POST",
        headers,
        body:    JSON.stringify({
          message:     text,
          board_id:    boardId,
          // ✅ Correct session key format per docs.acp.md
          session_key: `agent:main:${sessionKey}`,
          ...(agentId ? { agent_id: agentId } : {}),
          ...(instructions ? { instructions } : {}),
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok)   throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      if (!res.body) throw new Error("No response body");

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";
      let   tokens  = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const p     = JSON.parse(line.slice(6));
            if (p.error) throw new Error(p.error);
            const delta = p.delta ?? p.choices?.[0]?.delta?.content ?? "";
            if (p.usage?.output_tokens) tokens = p.usage.output_tokens;
            if (delta) {
              setMessages(prev => prev.map(m =>
                m.id === asstId
                  ? { ...m, content: m.content + delta, tokens: tokens || undefined }
                  : m
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
      setMessages(prev => prev.map(m =>
        m.id === asstId && !m.content ? { ...m, content: `⚠️ ${msg}` } : m
      ));
    }
  }, [boardId, sessionKey]);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    setStreamStatus("idle");
  }, []);

  return { messages, streamStatus, error, sendMessage, stopStream };
}
