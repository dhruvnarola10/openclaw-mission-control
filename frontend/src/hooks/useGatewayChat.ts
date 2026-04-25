import { useCallback, useEffect, useRef, useState } from 'react';

export type ChatMessage = { role: 'user' | 'assistant'; text: string };
export type ChatStatus = 'idle' | 'sending' | 'error';

/**
 * Chat hook that routes messages through the mission-control backend.
 *
 * Architecture:
 *   Browser → POST /api/v1/gateways/sessions/{session_id}/message → backend → gateway
 *
 * Configuration (set in frontend/.env or .env.local):
 *   NEXT_PUBLIC_API_URL        – base URL of the mission-control backend (default: auto)
 *   NEXT_PUBLIC_CHAT_BOARD_ID  – board_id whose gateway is used for chat
 */

// ---- helper: extract human-readable text from a gateway message object ----
// The gateway stores content as an array of blocks: [{type:"text", text:"..."}]
// or as a plain string. It may also have an errorMessage field.
function extractText(m: Record<string, unknown>): string {
  // 1. content is an array of blocks
  if (Array.isArray(m.content)) {
    const parts = (m.content as unknown[])
      .filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null)
      .filter((b) => b.type === 'text')
      .map((b) => (typeof b.text === 'string' ? b.text : ''))
      .join('');
    if (parts) return parts;
    // content array was empty — fall through to errorMessage
  }

  // 2. content is a plain string
  if (typeof m.content === 'string' && m.content) return m.content;

  // 3. top-level text field
  if (typeof m.text === 'string' && m.text) return m.text;

  // 4. errorMessage (e.g. rate-limit errors from the model)
  if (typeof m.errorMessage === 'string' && m.errorMessage) {
    return `⚠️ ${m.errorMessage}`;
  }

  // 5. last resort
  return JSON.stringify(m);
}

// ---- helper: map raw gateway history items to ChatMessage ----
function mapHistory(rawHistory: unknown[]): ChatMessage[] {
  return rawHistory
    .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
    .map((m) => {
      const role =
        (m.role as string) === 'assistant' || (m.role as string) === 'agent'
          ? 'assistant'
          : 'user';
      return { role, text: extractText(m) };
    });
}

export function useGatewayChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const sessionKeyRef = useRef<string>('');

  // ---- derive a stable session key (persisted in localStorage) ----
  useEffect(() => {
    let key = localStorage.getItem('openclawChatSessionKey');
    if (!key) {
      key = 'browser-chat-' + Math.random().toString(36).slice(2, 12);
      localStorage.setItem('openclawChatSessionKey', key);
    }
    sessionKeyRef.current = key;

    // Load existing chat history on mount
    const boardId =
      process.env.NEXT_PUBLIC_CHAT_BOARD_ID ||
      localStorage.getItem('openclawChatBoardId');
    if (!boardId) return;

    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const rawApiUrl = process.env.NEXT_PUBLIC_API_URL;
    const apiBase = (!rawApiUrl || rawApiUrl === 'auto')
      ? `http://${hostname}:8000`
      : rawApiUrl.replace(/\/$/, '');

    const token =
      (typeof window !== 'undefined' ? window.sessionStorage.getItem('mc_local_auth_token') : null) ||
      localStorage.getItem('openclawGatewayToken') ||
      '';

    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const historyUrl =
      `${apiBase}/api/v1/gateways/sessions/${encodeURIComponent(key)}/history` +
      `?board_id=${encodeURIComponent(boardId)}`;

    fetch(historyUrl, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const rawHistory: unknown[] = data?.history ?? [];
        if (!Array.isArray(rawHistory) || rawHistory.length === 0) return;
        const mapped = mapHistory(rawHistory);
        if (mapped.length > 0) setMessages(mapped);
      })
      .catch(() => {/* silently ignore history load failure */});
  }, []);

  // ---- build the backend API base URL ----
  const getApiBase = useCallback((): string => {
    const raw = process.env.NEXT_PUBLIC_API_URL;
    if (!raw || raw === 'auto') {
      const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
      return `http://${hostname}:8000`;
    }
    return raw.replace(/\/$/, '');
  }, []);

  // ---- helper: get bearer token from sessionStorage (set by the app auth) ----
  const getAuthHeader = useCallback((): Record<string, string> => {
    // The local auth mode stores the token in sessionStorage under 'mc_local_auth_token'
    // (see frontend/src/auth/localAuth.ts)
    const token =
      (typeof window !== 'undefined' ? window.sessionStorage.getItem('mc_local_auth_token') : null) ||
      localStorage.getItem('openclawGatewayToken') ||
      '';
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, []);

  // ---- send a message ----
  const send = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;

      const boardId =
        process.env.NEXT_PUBLIC_CHAT_BOARD_ID ||
        localStorage.getItem('openclawChatBoardId');

      if (!boardId) {
        setError(
          'No board configured for chat. Set NEXT_PUBLIC_CHAT_BOARD_ID in your .env file, ' +
          'or paste a board ID into localStorage key "openclawChatBoardId".',
        );
        return;
      }

      // Optimistic UI
      setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
      setStatus('sending');
      setError(null);

      const sessionKey = sessionKeyRef.current;
      const apiBase = getApiBase();
      const url = `${apiBase}/api/v1/gateways/sessions/${encodeURIComponent(sessionKey)}/message?board_id=${encodeURIComponent(boardId)}`;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
          },
          body: JSON.stringify({ content: trimmed }),
        });

        if (!res.ok) {
          const detail = await res.text();
          throw new Error(`Backend returned ${res.status}: ${detail}`);
        }

        await pollHistory(boardId, apiBase, sessionKey);
        setStatus('idle');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus('error');
        console.error('[useGatewayChat] send failed:', msg);
      }
    },
    [getApiBase, getAuthHeader],
  );

  // ---- poll chat history to retrieve the assistant reply ----
  const pollHistory = useCallback(
    async (boardId: string, apiBase: string, sessionKey: string) => {
      const historyUrl =
        `${apiBase}/api/v1/gateways/sessions/${encodeURIComponent(sessionKey)}/history` +
        `?board_id=${encodeURIComponent(boardId)}`;

      const maxAttempts = 30;
      const pollInterval = 1000;

      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, pollInterval));
        try {
          const res = await fetch(historyUrl, { headers: getAuthHeader() });
          if (!res.ok) continue;
          const data = await res.json();
          const rawHistory: unknown[] = data?.history ?? [];
          if (!Array.isArray(rawHistory)) continue;

          const mapped = mapHistory(rawHistory);
          if (mapped.length > 0) setMessages(mapped);

          // Stop polling once we get an assistant message at the end
          const last = mapped[mapped.length - 1];
          if (last?.role === 'assistant') break;
        } catch {
          // ignore transient errors and keep polling
        }
      }
    },
    [getAuthHeader],
  );

  return { messages, send, status, error };
}
