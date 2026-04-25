"use client";

import { useState } from 'react';
import { useGatewayChat } from '../../hooks/useGatewayChat';
import { DashboardPageLayout } from "@/components/templates/DashboardPageLayout";
import { cn } from "@/lib/utils";

export default function ChatPage() {
  const { messages, send, status } = useGatewayChat();
  const [input, setInput] = useState('');

  const tokenMissing = typeof window !== 'undefined' && 
    !process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_TOKEN && 
    !localStorage.getItem('openclawGatewayToken');

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
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
        {/* Token bootstrap UI */}
        {tokenMissing && (
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 md:p-4 text-sm text-yellow-800">
            <p className="font-semibold mb-2">OpenClaw token missing</p>
            <p className="mb-3">
              Copy the token you generated with <code className="bg-yellow-100 px-1 py-0.5 rounded text-yellow-900 font-mono text-xs md:text-sm">openclaw gateway token generate</code> and paste it below.
            </p>
            <input
              type="text"
              placeholder="Paste gateway token here"
              className="w-full rounded-md border border-yellow-300 px-3 py-2 text-base md:text-sm bg-white"
              onBlur={e => {
                const t = e.target.value.trim();
                if (t) localStorage.setItem('openclawGatewayToken', t);
              }}
            />
          </div>
        )}

        {/* Status indicator */}
        <div className="flex items-center gap-2 text-xs md:text-sm text-slate-500 px-1">
          <span>Gateway status:</span>
          <span className={cn(
            "font-medium",
            status === 'open' ? "text-emerald-600" :
            status === 'connecting' ? "text-amber-500" : "text-rose-500"
          )}>
            {status === 'open' ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Disconnected'}
          </span>
        </div>

        {/* Chat window */}
        <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm h-[65vh] md:h-auto md:min-h-[500px]">
          <div className="flex flex-1 flex-col overflow-y-auto p-3 md:p-4 space-y-4 bg-slate-50 md:min-h-[400px]">
            {messages.length === 0 && status === 'open' ? (
              <div className="flex h-full flex-1 items-center justify-center text-slate-500 text-sm text-center px-4">
                Type a message below to start chatting.
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
          </div>
          
          <div className="border-t border-slate-200 p-3 md:p-4 bg-white">
            <div className="flex gap-2 flex-col sm:flex-row">
              <input
                type="text"
                value={input}
                placeholder="Ask OpenClaw..."
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all w-full"
              />
              <button 
                onClick={handleSend}
                disabled={!input.trim() || status !== 'open'}
                className={cn(
                  "rounded-lg px-6 py-2.5 text-sm font-medium text-white transition-colors w-full sm:w-auto",
                  input.trim() && status === 'open' 
                    ? "bg-blue-600 hover:bg-blue-700 shadow-sm" 
                    : "bg-slate-300 cursor-not-allowed"
                )}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </DashboardPageLayout>
  );
}
