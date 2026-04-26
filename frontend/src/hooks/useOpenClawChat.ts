import { useCallback, useRef, useState } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tokens?: number;
  timestamp: Date;
}

export type StreamStatus = 'idle' | 'streaming' | 'error';

/**
 * Streaming chat hook backed by POST /api/v1/chat/stream.
 *
 * The backend proxy:
 *   1. Resolves the gateway config from the board_id (server-side auth)
 *   2. Tries gateway /v1/responses SSE endpoint for real-time streaming
 *   3. Falls back to chat.send RPC for older gateway builds
 *
 * SSE event types handled:
 *   response.output_text.delta   – append delta text to the assistant bubble
 *   response.completed           – capture total token usage
 *   [DONE]                       – stream finished
 */
export function useOpenClawChat(sessionKey: string, boardId: string, agentId?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ---- helper: get the mc_local_auth_token set by the local auth system ----
  const getAuthHeader = (): Record<string, string> => {
    const token =
      (typeof window !== 'undefined' ? window.sessionStorage.getItem('mc_local_auth_token') : null) ||
      '';
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  };

  // ---- resolve backend base URL ----
  const getApiBase = (): string => {
    const raw = process.env.NEXT_PUBLIC_API_URL;
    if (!raw || raw === 'auto') {
      const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
      return `http://${hostname}:8000`;
    }
    return raw.replace(/\/$/, '');
  };

  const sendMessage = useCallback(
    async (text: string, instructions?: string) => {
      if (!text.trim() || streamStatus === 'streaming') return;

      setError(null);

      // Optimistic: add user bubble immediately
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Prepare empty assistant bubble
      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '', timestamp: new Date() },
      ]);

      setStreamStatus('streaming');
      abortRef.current = new AbortController();

      try {
        const apiBase = getApiBase();
        const res = await fetch(`${apiBase}/api/v1/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({
            message: text,
            session_key: sessionKey,
            board_id: boardId,
            agent_id: agentId ?? null,
            instructions: instructions ?? null,
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const detail = await res.text();
          throw new Error(`Gateway error ${res.status}: ${detail}`);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (raw === '[DONE]') break;

            try {
              const evt = JSON.parse(raw) as Record<string, unknown>;

              // Streaming text delta
              if (evt.type === 'response.output_text.delta') {
                const delta = typeof evt.delta === 'string' ? evt.delta : '';
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: m.content + delta } : m,
                  ),
                );
              }

              // Final usage stats
              if (evt.type === 'response.completed') {
                const usage = evt.response as Record<string, unknown> | undefined;
                const tokens = (usage?.usage as Record<string, unknown> | undefined)?.total_tokens;
                if (typeof tokens === 'number') {
                  setMessages((prev) =>
                    prev.map((m) => (m.id === assistantId ? { ...m, tokens } : m)),
                  );
                }
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }

        // If the assistant bubble is still empty after [DONE] (fallback path),
        // mark it as delivered so the user knows to check via history polling.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.content === ''
              ? { ...m, content: '✓ Message delivered — reply will appear in chat history shortly.' }
              : m,
          ),
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          // User stopped the stream — clean up empty bubble
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          // Update the empty assistant bubble with the error
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: `⚠️ ${msg}` } : m,
            ),
          );
        }
        setStreamStatus('error');
        return;
      }

      setStreamStatus('idle');
    },
    [sessionKey, boardId, agentId, streamStatus],
  );

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    setStreamStatus('idle');
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, streamStatus, error, sendMessage, stopStream, clearMessages };
}
