"use client";

import { useState } from 'react';
import { useGatewayChat } from '../../hooks/useGatewayChat';
import { DashboardPageLayout } from "@/components/templates/DashboardPageLayout";
import { cn } from "@/lib/utils";

export default function ChatPage() {
  const { messages, send, status, error } = useGatewayChat();
  const [input, setInput] = useState('');

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
      <div className="flex flex-col gap-4 md:gap-6 max-w-4xl mx-auto w-full">

        {/* Board ID setup banner */}
        {boardMissing && (
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 md:p-4 text-sm text-yellow-800">
            <p className="font-semibold mb-2">Board not configured for chat</p>
            <p className="mb-3">
              Set <code className="bg-yellow-100 px-1 py-0.5 rounded text-yellow-900 font-mono text-xs">NEXT_PUBLIC_CHAT_BOARD_ID</code> in your{' '}
              <code className="bg-yellow-100 px-1 py-0.5 rounded text-yellow-900 font-mono text-xs">frontend/.env</code>, or paste your board ID below (from the Boards page URL).
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

        {/* Error banner */}
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 md:p-4 text-sm text-rose-800">
            <p className="font-semibold mb-1">Error</p>
            <p className="break-words">{error}</p>
          </div>
        )}

        {/* Status */}
        <div className="flex items-center gap-2 text-xs md:text-sm text-slate-500 px-1">
          <span className={cn(
            "h-2 w-2 rounded-full shrink-0",
            isSending ? "bg-amber-400 animate-pulse" : "bg-emerald-500"
          )} />
          <span className="font-medium text-slate-700">
            {isSending ? 'Sending…' : 'Ready'}
          </span>
        </div>

        {/* Chat window */}
        <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm h-[65vh] md:h-auto md:min-h-[500px]">
          <div className="flex flex-1 flex-col overflow-y-auto p-3 md:p-4 space-y-4 bg-slate-50 md:min-h-[400px]">
            {messages.length === 0 ? (
              <div className="flex h-full flex-1 items-center justify-center text-slate-500 text-sm text-center px-4">
                {boardMissing
                  ? 'Configure a board above to start chatting.'
                  : 'Type a message below to start chatting.'}
              </div>
            ) : null}

            {messages.map((m, i) => (
              <div key={i} className={cn(
                "flex flex-col max-w-[92%] md:max-w-[80%] rounded-2xl px-4 py-3 text-sm",
                m.role === 'user'
                  ? "self-end bg-blue-600 text-white rounded-br-none"
                  : "self-start bg-white border border-slate-200 text-slate-800 rounded-bl-none shadow-sm"
              )}>
                <div className="font-semibold text-[10px] md:text-[11px] uppercase tracking-wide mb-1 opacity-80">
                  {m.role === 'user' ? 'You' : 'Assistant'}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed break-words">{m.text}</div>
              </div>
            ))}

            {/* Typing indicator while waiting */}
            {isSending && (
              <div className="self-start bg-white border border-slate-200 text-slate-500 rounded-2xl rounded-bl-none shadow-sm px-4 py-3 text-sm flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
                <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
                <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" />
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 p-3 md:p-4 bg-white">
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
