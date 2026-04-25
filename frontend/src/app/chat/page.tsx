"use client";

import { useEffect, useRef, useState } from 'react';
import { useGatewayChat } from '../../hooks/useGatewayChat';
import { DashboardPageLayout } from "@/components/templates/DashboardPageLayout";
import { cn } from "@/lib/utils";

// Parse a raw error string: if it's JSON with a "detail" field, return that.
function parseErrorMessage(raw: string): string {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      if (typeof parsed.detail === 'string') return parsed.detail;
    }
  } catch {/* not JSON */}
  return raw;
}

// Human-friendly description of common errors
function friendlyError(raw: string): { title: string; detail: string } {
  const detail = parseErrorMessage(raw);
  if (detail.includes('Connection refused') || detail.includes('Errno 111')) {
    return {
      title: 'Gateway unreachable',
      detail: 'Could not connect to the OpenClaw gateway. Make sure it is running and the board has a connected gateway.',
    };
  }
  if (raw.includes('401')) {
    return { title: 'Unauthorized', detail: 'Your session token is invalid or expired. Try refreshing the page and signing in again.' };
  }
  if (raw.includes('502') || raw.includes('503')) {
    return { title: 'Gateway error', detail: detail || 'The backend could not reach the gateway.' };
  }
  if (raw.includes('No board configured')) {
    return { title: 'Board not configured', detail: detail };
  }
  return { title: 'Error', detail };
}

export default function ChatPage() {
  const { messages, send, status, error } = useGatewayChat();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isSending = status === 'sending';
  const canSend = !!input.trim() && !isSending;

  // Show board-id setup banner if needed
  const boardMissing = typeof window !== 'undefined' &&
    !process.env.NEXT_PUBLIC_CHAT_BOARD_ID &&
    !localStorage.getItem('openclawChatBoardId');

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;
    send(trimmed);
    setInput('');
  };

  // Auto-scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const errorInfo = error ? friendlyError(error) : null;

  return (
    <DashboardPageLayout
      signedOut={{
        message: "Sign in to view chat.",
        forceRedirectUrl: "/chat",
      }}
      title="OpenClaw Chat"
      description="Talk to the OpenClaw assistant directly through the local gateway."
      stickyHeader
    >
      {/* Fixed-height container — only the message list scrolls, not the whole page */}
      <div className="flex flex-col max-w-4xl mx-auto w-full h-[calc(100vh-180px)] min-h-[500px]">

        {/* Board ID setup banner */}
        {boardMissing && (
          <div className="mb-3 rounded-xl border border-yellow-200 bg-yellow-50 p-3 md:p-4 text-sm text-yellow-800 shrink-0">
            <p className="font-semibold mb-2">Board not configured for chat</p>
            <p className="mb-3">
              Set <code className="bg-yellow-100 px-1 py-0.5 rounded text-yellow-900 font-mono text-xs">NEXT_PUBLIC_CHAT_BOARD_ID</code> in your{' '}
              <code className="bg-yellow-100 px-1 py-0.5 rounded text-yellow-900 font-mono text-xs">frontend/.env</code>, or paste your board ID below.
            </p>
            <input
              type="text"
              placeholder="Paste board ID here (e.g. 3fa85f64-5717-...)"
              className="w-full rounded-md border border-yellow-300 px-3 py-2 text-base md:text-sm bg-white"
              onBlur={e => {
                const t = e.target.value.trim();
                if (t) localStorage.setItem('openclawChatBoardId', t);
              }}
            />
          </div>
        )}

        {/* Error banner — parsed and human-friendly */}
        {errorInfo && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 md:p-4 text-sm text-rose-800 shrink-0">
            <div className="flex items-start gap-2">
              <span className="text-rose-500 mt-0.5 shrink-0">⚠️</span>
              <div>
                <p className="font-semibold">{errorInfo.title}</p>
                <p className="mt-0.5 text-rose-700">{errorInfo.detail}</p>
              </div>
            </div>
          </div>
        )}

        {/* Status bar */}
        <div className="flex items-center gap-2 text-xs text-slate-500 px-1 mb-2 shrink-0">
          <span className={cn(
            "h-2 w-2 rounded-full shrink-0",
            isSending ? "bg-amber-400 animate-pulse" : "bg-emerald-500"
          )} />
          <span className="font-medium text-slate-600">
            {isSending ? 'Waiting for reply…' : 'Ready'}
          </span>
        </div>

        {/* Chat card — fills remaining height, message list scrolls internally */}
        <div className="flex flex-col flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

          {/* Message list — this is the only scrollable area */}
          <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-4 bg-slate-50">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-slate-400 text-sm text-center px-4">
                {boardMissing
                  ? 'Configure a board above to start chatting.'
                  : 'Type a message below to start chatting.'}
              </div>
            ) : null}

            {messages.map((m, i) => (
              <div key={i} className={cn(
                "flex flex-col max-w-[92%] md:max-w-[78%] rounded-2xl px-4 py-3 text-sm",
                m.role === 'user'
                  ? "self-end bg-blue-600 text-white rounded-br-none"
                  : m.text.startsWith('⚠️')
                    ? "self-start bg-rose-50 border border-rose-200 text-rose-800 rounded-bl-none shadow-sm"
                    : "self-start bg-white border border-slate-200 text-slate-800 rounded-bl-none shadow-sm"
              )}>
                <div className="font-semibold text-[10px] md:text-[11px] uppercase tracking-wide mb-1 opacity-70">
                  {m.role === 'user' ? 'You' : 'Assistant'}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed break-words">{m.text}</div>
              </div>
            ))}

            {/* Typing indicator while waiting for reply */}
            {isSending && (
              <div className="self-start bg-white border border-slate-200 rounded-2xl rounded-bl-none shadow-sm px-4 py-3 text-sm flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
                <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
                <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" />
              </div>
            )}

            {/* Anchor for auto-scroll */}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area — always pinned to bottom of the card */}
          <div className="border-t border-slate-200 p-3 md:p-4 bg-white shrink-0">
            <div className="flex gap-2 flex-col sm:flex-row">
              <input
                type="text"
                value={input}
                placeholder="Ask OpenClaw…"
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                disabled={isSending}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all w-full disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!canSend}
                className={cn(
                  "rounded-lg px-6 py-2.5 text-sm font-medium text-white transition-colors w-full sm:w-auto",
                  canSend
                    ? "bg-blue-600 hover:bg-blue-700 shadow-sm"
                    : "bg-slate-300 cursor-not-allowed"
                )}
              >
                {isSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </DashboardPageLayout>
  );
}
