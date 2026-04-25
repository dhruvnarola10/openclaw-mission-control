import { useEffect, useRef, useState } from 'react';

/**
 * Hook that connects to the OpenClaw gateway WS (local only).
 * Returns:
 *   - messages: array of {role:'user'|'assistant', text:string}
 *   - send: (prompt:string)=>void
 *   - status: 'connecting' | 'open' | 'closed' | 'error'
 */
export function useGatewayChat() {
  const [messages, setMessages] = useState<Array<{role: 'user' | 'assistant', text: string}>>([]);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const idRef = useRef<number>(1);

  // ---- initialise WS (runs once) ----
  useEffect(() => {
    // 1️⃣ read token from environment or localStorage (the UI will store it on first load if missing)
    const token = process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_TOKEN || localStorage.getItem('openclawGatewayToken') || '';
    
    // 2️⃣ Generate and store a persistent device ID so the gateway doesn't create a new pairing request on every reload
    let deviceId = localStorage.getItem('openclawDeviceId');
    if (!deviceId) {
      deviceId = 'browser-ui-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('openclawDeviceId', deviceId);
    }

    const hostname = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1';
    const gatewayBase = process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_WS_URL || `ws://${hostname}:18789`;
    const wsUrl = `${gatewayBase}/?token=${encodeURIComponent(token)}&clientId=${deviceId}&deviceId=${deviceId}`;

    console.log('[useGatewayChat] Connecting to:', wsUrl);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.addEventListener('open', () => setStatus('open'));
    ws.addEventListener('close', (e) => {
      console.log('WS closed', e.code, e.reason);
      setStatus('closed');
    });
    ws.addEventListener('error', (e) => {
      console.error('WS error', e);
      setStatus('error');
    });

    ws.addEventListener('message', ev => {
      try {
        const payload = JSON.parse(ev.data);
        // The gateway emits `chat` events with an `assistantMessage` field
        if (payload.method === 'chat' && payload.params?.assistantMessage) {
          const txt = (payload.params.assistantMessage.content ?? '').replace(/\r?\n/g, ' ');
          setMessages(prev => [...prev, { role: 'assistant', text: txt }]);
        }
      } catch (_) {
        // ignore malformed messages
      }
    });

    // cleanup on unmount
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []); // empty deps → run only once

  // ---- function to send a prompt ----
  const send = (prompt: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('WS not ready, cannot send');
      return;
    }

    // Optimistic UI: show user message immediately
    setMessages(prev => [...prev, { role: 'user', text: prompt }]);

    const id = idRef.current++;
    const request = {
      jsonrpc: '2.0',
      id,
      method: 'chat.send',
      params: {
        prompt,
        idempotencyKey: `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    };
    wsRef.current.send(JSON.stringify(request));
  };

  return { messages, send, status };
}
