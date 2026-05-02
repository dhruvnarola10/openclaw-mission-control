"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  RefreshCw,
  Send,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useGatewayWS } from "@/hooks/useGatewayWS";
import type { GatewayConfig } from "@/hooks/useGatewayConfig";

// ── Gateway config from env vars (no backend roundtrip needed) ────────────────

const GATEWAY_CONFIG: GatewayConfig = {
  url:   process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_WS_URL ?? "ws://localhost:18789",
  token: process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_TOKEN  ?? "",
};

// ── Known sessions ────────────────────────────────────────────────────────────

const SESSIONS = [
  { key: "agent:main:openresponses-user:mc-test",        label: "MC Test" },
  { key: "agent:main:openresponses-user:debug-direct-ui",label: "Debug UI" },
  { key: "agent:main:main",                              label: "Main" },
  { key: "agent:main:openresponses-user:my-chatapp-user-123", label: "ChatApp" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch { return; }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      title="Copy"
      className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded hover:bg-slate-200 dark:hover:bg-white/10 ml-1"
    >
      {copied
        ? <Check className="h-3.5 w-3.5 text-emerald-500" />
        : <Copy  className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" />}
    </button>
  );
}

function RenderText({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const inner = part.slice(3, -3).replace(/^\w+\n/, "");
          return (
            <pre key={i} className="my-2 rounded-lg bg-slate-100 dark:bg-black/30 px-3 py-2 text-xs font-mono overflow-x-auto whitespace-pre text-emerald-700 dark:text-emerald-300">
              {inner}
            </pre>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={i} className="rounded bg-slate-100 dark:bg-black/30 px-1 py-0.5 text-xs font-mono text-amber-700 dark:text-amber-300">{part.slice(1, -1)}</code>;
        }
        return part.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((seg, j) => {
          if (seg.startsWith("**") && seg.endsWith("**")) return <strong key={`${i}-${j}`}>{seg.slice(2, -2)}</strong>;
          if (seg.startsWith("*")  && seg.endsWith("*"))  return <em key={`${i}-${j}`}>{seg.slice(1, -1)}</em>;
          return <span key={`${i}-${j}`}>{seg}</span>;
        });
      })}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [sessionIdx,   setSessionIdx]   = useState(0);
  const [showPicker,   setShowPicker]   = useState(false);
  const [input,        setInput]        = useState("");
  const pickerRef  = useRef<HTMLDivElement>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sessionKey = SESSIONS[sessionIdx].key;

  const { messages, wsStatus, isTyping, error, sendMessage, abortRun, loadHistory } =
    useGatewayWS({ config: GATEWAY_CONFIG, sessionKey });

  const isConnected = wsStatus === "connected";
  const canSend     = isConnected && !!input.trim() && !isTyping;

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // Close session picker on outside click
  useEffect(() => {
    if (!showPicker) return;
    const h = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node))
        setShowPicker(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showPicker]);

  const handleSend = useCallback(() => {
    if (!canSend) return;
    void sendMessage(input.trim());
    setInput("");
  }, [canSend, input, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Status dot + label
  const statusColor =
    wsStatus === "connected"   ? "bg-emerald-500" :
    wsStatus === "connecting"  ? "bg-yellow-400 animate-pulse" :
    wsStatus === "error"       ? "bg-rose-500" :
                                 "bg-slate-400";
  const statusLabel =
    wsStatus === "connected"   ? "Connected" :
    wsStatus === "connecting"  ? "Connecting…" :
    wsStatus === "error"       ? "Error" :
                                 "Disconnected";

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-w-4xl mx-auto w-full">

      {/* ── Header ── */}
      <div className="shrink-0 rounded-t-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center gap-3 flex-wrap">

        {/* Icon + title */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-blue-100 border border-blue-200 dark:bg-blue-600/20 dark:border-blue-500/30 flex items-center justify-center shrink-0">
            <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-none">OpenClaw Chat</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", statusColor)} />
              {isTyping
                ? <><Wifi className="h-3 w-3 text-blue-400 animate-pulse" /><span className="text-[11px] text-blue-500 dark:text-blue-400">Agent is thinking…</span></>
                : <><Wifi className="h-3 w-3 text-slate-400" /><span className="text-[11px] text-slate-500 dark:text-slate-400">{statusLabel}</span></>}
            </div>
          </div>
        </div>

        {/* Session picker */}
        <div className="relative ml-auto" ref={pickerRef}>
          <button
            onClick={() => setShowPicker(v => !v)}
            className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300"
          >
            <span className="max-w-[160px] truncate font-mono">{SESSIONS[sessionIdx].label}</span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          </button>

          {showPicker && (
            <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
              <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                Sessions
              </p>
              {SESSIONS.map((s, i) => (
                <button
                  key={s.key}
                  onClick={() => { setSessionIdx(i); setShowPicker(false); }}
                  className={cn(
                    "w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors",
                    i === sessionIdx && "bg-blue-50 dark:bg-blue-900/20",
                  )}
                >
                  <div className="text-xs font-medium text-slate-800 dark:text-slate-200">{s.label}</div>
                  <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate mt-0.5">{s.key}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Reload history */}
        <button
          onClick={() => loadHistory()}
          title="Reload history"
          disabled={!isConnected}
          className="h-[30px] w-[30px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40"
        >
          <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-col flex-1 overflow-hidden border-x border-b border-slate-200 dark:border-slate-700 rounded-b-2xl bg-white dark:bg-slate-950 shadow-xl">

        {/* Error banner */}
        {error && (
          <div className="shrink-0 mx-4 mt-3 rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">
            <span className="font-semibold">Error: </span>{error}
          </div>
        )}

        {/* Disconnected banner */}
        {wsStatus === "error" || wsStatus === "disconnected" ? (
          <div className="shrink-0 mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300 flex items-center gap-2">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>Not connected to gateway — check <code className="text-xs font-mono">NEXT_PUBLIC_OPENCLAW_GATEWAY_WS_URL</code> and rebuild.</span>
          </div>
        ) : null}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !isTyping && (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-16 text-center">
              <div className="h-14 w-14 rounded-2xl bg-blue-50 border border-blue-100 dark:bg-blue-600/15 dark:border-blue-500/20 flex items-center justify-center">
                <Bot className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-slate-800 dark:text-slate-300 font-medium text-sm">
                  {isConnected ? "No messages yet" : "Connecting to gateway…"}
                </p>
                <p className="text-slate-500 text-xs mt-1 font-mono">{sessionKey}</p>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "group flex gap-2.5 max-w-[90%] md:max-w-[78%]",
                msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto",
              )}
            >
              {msg.role === "assistant" && (
                <div className="shrink-0 flex items-end">
                  <div className="h-7 w-7 rounded-full bg-blue-100 border border-blue-200 dark:bg-blue-600/20 dark:border-blue-500/30 flex items-center justify-center">
                    <Bot className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  </div>
                </div>
              )}
              <div className={cn(
                "relative rounded-2xl px-4 py-3 text-sm shadow-sm",
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-tr-none"
                  : "bg-slate-50 border border-slate-200 text-slate-800 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 rounded-tl-none",
              )}>
                <div className="flex items-start gap-2">
                  <div className="leading-relaxed whitespace-pre-wrap break-words flex-1">
                    {msg.role === "assistant"
                      ? <RenderText text={msg.content} />
                      : msg.content}
                  </div>
                  <CopyButton text={msg.content} />
                </div>
              </div>
            </div>
          ))}

          {/* Thinking indicator */}
          {isTyping && (
            <div className="flex gap-2.5 mr-auto">
              <div className="h-7 w-7 rounded-full bg-blue-100 border border-blue-200 dark:bg-blue-600/20 dark:border-blue-500/30 flex items-center justify-center shrink-0">
                <Bot className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-2xl rounded-tl-none px-4 py-3">
                <span className="h-2 w-2 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.3s]" />
                <span className="h-2 w-2 rounded-full bg-blue-400 animate-bounce [animation-delay:-0.15s]" />
                <span className="h-2 w-2 rounded-full bg-blue-400 animate-bounce" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Input bar ── */}
        <div className="shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
          <div className="flex gap-2 items-end">
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!isConnected || isTyping}
                placeholder={
                  !isConnected ? "Connecting to gateway…" :
                  isTyping     ? "Agent is responding…" :
                                 "Message OpenClaw… (Enter to send)"
                }
                rows={1}
                className="w-full resize-none overflow-hidden rounded-xl border border-slate-300 bg-slate-50 text-slate-900 placeholder:text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:placeholder:text-slate-500 px-4 py-2.5 pr-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
              />
              {input.length > 0 && (
                <span className="absolute bottom-2 right-3 text-[10px] text-slate-400">{input.length}</span>
              )}
            </div>

            {isTyping ? (
              <button
                onClick={() => void abortRun()}
                title="Stop generation"
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow-sm"
              >
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                title="Send (Enter)"
                className={cn(
                  "flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-white shadow-sm",
                  canSend
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "bg-slate-200 dark:bg-slate-700 cursor-not-allowed opacity-50",
                )}
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-1.5 text-center text-[10px] text-slate-500 dark:text-slate-600">
            Direct WebSocket · {GATEWAY_CONFIG.url} · Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>
    </div>
  );
}
