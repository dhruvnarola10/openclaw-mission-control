"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  History,
  MessageSquarePlus,
  Send,
  Square,
  Wifi,
  Plug,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useGatewaySSEChat, loadSessions, type SessionMeta } from "@/hooks/useGatewaySSEChat";
import { usePluginChat } from "@/hooks/usePluginChat";

// ── Helpers ───────────────────────────────────────────────────────────────────

function newSessionKey() {
  return "chat-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  };
  return (
    <button
      onClick={copy}
      title="Copy"
      className="opacity-0 group-hover:opacity-100 ml-auto shrink-0 p-1 rounded hover:bg-slate-200 dark:hover:bg-white/10"
    >
      {copied
        ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        : <Copy  className="h-3.5 w-3.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200" />}
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

function formatTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ── Mode toggle ───────────────────────────────────────────────────────────────

type ChatMode = "direct" | "plugin";

const DIRECT_BOARD_ID = process.env.NEXT_PUBLIC_CHAT_BOARD_ID ?? "";
const PLUGIN_BOARD_ID = process.env.NEXT_PUBLIC_MC_CHAT_BOARD_ID ?? DIRECT_BOARD_ID;

// ── Component ─────────────────────────────────────────────────────────────────

export default function ChatWindow() {
  const [sessionKey, setSessionKey] = useState<string>(newSessionKey);
  const [input, setInput]           = useState<string>("");
  const [mode, setMode]             = useState<ChatMode>("direct");

  // History dropdown
  const [showHistory, setShowHistory]   = useState(false);
  const [pastSessions, setPastSessions] = useState<SessionMeta[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);

  // ── Direct mode: MC backend proxies POST /v1/responses to the gateway ──────
  const directChat = useGatewaySSEChat({
    sessionKey,
    agentId: process.env.NEXT_PUBLIC_MC_CHAT_AGENT_ID ?? "main",
  });

  // ── Plugin mode: routes via MC backend + openclaw channel plugin ────────────
  const pluginChat = usePluginChat({
    boardId:  PLUGIN_BOARD_ID,
    sessionKey,
    agentId:  process.env.NEXT_PUBLIC_MC_CHAT_AGENT_ID ?? "main",
  });

  const chat = mode === "plugin" ? pluginChat : directChat;
  const { messages, streamStatus, error, sendMessage, stopStream, clearMessages } = chat;

  const isStreaming = streamStatus === "streaming";
  const canSend     = !!input.trim() && !isStreaming;

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [messages, isStreaming]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // Close history dropdown on outside click
  useEffect(() => {
    if (!showHistory) return;
    const handler = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showHistory]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    if (!canSend) return;
    void sendMessage(input.trim());
    setInput("");
  }, [canSend, input, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = () => {
    clearMessages();
    setSessionKey(newSessionKey());
    setInput("");
    setShowHistory(false);
  };

  const handleModeSwitch = (next: ChatMode) => {
    clearMessages();
    setMode(next);
    setSessionKey(newSessionKey());
    setInput("");
  };

  const openHistory = () => {
    setPastSessions(loadSessions());
    setShowHistory((v) => !v);
  };

  const restoreSession = (key: string) => {
    if (isStreaming) stopStream();
    setMode("direct");
    setSessionKey(key);
    setInput("");
    setShowHistory(false);
  };

  // ── Labels ─────────────────────────────────────────────────────────────────
  const modeLabel =
    mode === "plugin"
      ? `board:${PLUGIN_BOARD_ID || "?"} · MC plugin`
      : `/v1/responses`;

  return (
    <div className="flex flex-col h-[calc(100vh-148px)] min-h-[520px] max-w-4xl mx-auto w-full">

      {/* ── Header ── */}
      <div className="shrink-0 rounded-t-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">

        {/* Brand + status */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-100 border border-blue-200 dark:bg-blue-600/20 dark:border-blue-500/30 shrink-0">
            {mode === "plugin"
              ? <Plug className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              : <Bot  className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-none">OpenClaw Chat</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 shrink-0" />
              <Wifi className="h-3 w-3 text-slate-400 dark:text-slate-500" />
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">{modeLabel}</span>
            </div>
          </div>
        </div>

        {/* Mode toggle + Session + History + New Chat */}
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">

          {/* Mode switcher */}
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
            <button
              onClick={() => handleModeSwitch("direct")}
              className={cn(
                "px-2.5 py-1.5 font-medium",
                mode === "direct"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
              )}
            >
              Direct
            </button>
            <button
              onClick={() => handleModeSwitch("plugin")}
              disabled={!PLUGIN_BOARD_ID}
              title={!PLUGIN_BOARD_ID ? "Set NEXT_PUBLIC_MC_CHAT_BOARD_ID to enable" : undefined}
              className={cn(
                "px-2.5 py-1.5 font-medium",
                mode === "plugin"
                  ? "bg-violet-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                !PLUGIN_BOARD_ID && "opacity-40 cursor-not-allowed",
              )}
            >
              Plugin
            </button>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Session</span>
            <span className="text-[11px] text-slate-700 dark:text-slate-300 font-mono truncate max-w-[110px]">
              {sessionKey}
            </span>
          </div>

          {/* History dropdown */}
          <div className="relative" ref={historyRef}>
            <button
              onClick={openHistory}
              title="Chat history"
              className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-xs font-medium rounded-lg px-2.5 py-1.5"
            >
              <History className="h-3.5 w-3.5" />
              History
            </button>

            {showHistory && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Recent chats</p>
                </div>
                {pastSessions.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-slate-500 dark:text-slate-500">
                    No saved chats yet
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {pastSessions.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => restoreSession(s.key)}
                        className={cn(
                          "w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors",
                          s.key === sessionKey && "bg-blue-50 dark:bg-blue-900/20",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-500 truncate">
                            {s.key}
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-600 shrink-0">
                            {formatTime(s.updatedAt)}
                          </span>
                        </div>
                        {s.preview && (
                          <p className="text-xs text-slate-700 dark:text-slate-300 mt-0.5 truncate">
                            {s.preview}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            id="new-chat-btn"
            onClick={handleNewChat}
            title="Start new chat session"
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg px-3 py-1.5 shadow-sm"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            New Chat
          </button>
        </div>
      </div>

      {/* ── Chat body ── */}
      <div className="flex flex-col flex-1 overflow-hidden border-x border-b border-slate-200 dark:border-slate-700 rounded-b-2xl bg-white dark:bg-slate-950 shadow-xl">

        {/* Error banner */}
        {error && (
          <div className="shrink-0 mx-4 mt-3 rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">
            <span className="font-semibold">Error: </span>{error}
          </div>
        )}

        {/* Plugin-mode no-board warning */}
        {mode === "plugin" && !PLUGIN_BOARD_ID && (
          <div className="shrink-0 mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
            Set <code className="font-mono text-xs">NEXT_PUBLIC_MC_CHAT_BOARD_ID</code> in{" "}
            <code className="font-mono text-xs">frontend/.env</code> to use plugin mode.
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          {messages.length === 0 && !isStreaming && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-16">
              <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-blue-50 border border-blue-100 dark:bg-blue-600/15 dark:border-blue-500/20">
                {mode === "plugin"
                  ? <Plug className="h-6 w-6 text-violet-600 dark:text-violet-400" />
                  : <Bot  className="h-6 w-6 text-blue-600 dark:text-blue-400" />}
              </div>
              <div>
                <p className="text-slate-800 dark:text-slate-300 font-medium text-sm">Start a conversation</p>
                <p className="text-slate-500 dark:text-slate-500 text-xs mt-1">
                  {mode === "plugin"
                    ? `Plugin mode · board:${PLUGIN_BOARD_ID || "?"} · Enter to send`
                    : `Direct SSE · /v1/responses · Enter to send`}
                </p>
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
                  <div className={cn(
                    "h-7 w-7 rounded-full border flex items-center justify-center",
                    mode === "plugin"
                      ? "bg-violet-100 border-violet-200 dark:bg-violet-600/20 dark:border-violet-500/30"
                      : "bg-blue-100 border-blue-200 dark:bg-blue-600/20 dark:border-blue-500/30",
                  )}>
                    {mode === "plugin"
                      ? <Plug className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                      : <Bot  className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />}
                  </div>
                </div>
              )}

              <div className={cn(
                "relative flex flex-col rounded-2xl px-4 py-3 text-sm shadow-sm",
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-tr-none"
                  : "bg-slate-50 border border-slate-200 text-slate-800 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 rounded-tl-none",
              )}>
                <div className="flex items-start gap-2">
                  <div className="leading-relaxed whitespace-pre-wrap break-words flex-1">
                    {msg.role === "assistant" && msg.content === "" && isStreaming && msg.id === messages[messages.length - 1]?.id ? (
                      <span className="text-slate-400 dark:text-slate-500 italic text-xs animate-pulse">Thinking…</span>
                    ) : msg.role === "assistant" ? (
                      <RenderText text={msg.content} />
                    ) : (
                      msg.content
                    )}
                    {isStreaming && msg.role === "assistant" && msg.content !== "" && msg.id === messages[messages.length - 1]?.id && (
                      <span className="inline-block w-0.5 h-4 bg-blue-600 dark:bg-blue-400 ml-0.5 align-middle animate-pulse" />
                    )}
                  </div>
                  <CopyButton text={msg.content} />
                </div>
              </div>
            </div>
          ))}

          {/* Typing dots */}
          {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex gap-2.5 mr-auto">
              <div className={cn(
                "h-7 w-7 rounded-full border flex items-center justify-center shrink-0",
                mode === "plugin"
                  ? "bg-violet-100 border-violet-200 dark:bg-violet-600/20 dark:border-violet-500/30"
                  : "bg-blue-100 border-blue-200 dark:bg-blue-600/20 dark:border-blue-500/30",
              )}>
                {mode === "plugin"
                  ? <Plug className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                  : <Bot  className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />}
              </div>
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-2xl rounded-tl-none px-4 py-3">
                <span className="h-2 w-2 rounded-full bg-slate-400 dark:bg-slate-500" />
                <span className="h-2 w-2 rounded-full bg-slate-400 dark:bg-slate-500" />
                <span className="h-2 w-2 rounded-full bg-slate-400 dark:bg-slate-500" />
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
                id="chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                placeholder={
                  isStreaming
                    ? "Waiting for response…"
                    : "Message OpenClaw… (Enter ↵ to send, Shift+Enter for newline)"
                }
                rows={1}
                className="w-full resize-none overflow-hidden rounded-xl border border-slate-300 bg-slate-50 text-slate-900 placeholder:text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:placeholder:text-slate-500 px-4 py-2.5 pr-12 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
              />
              {input.length > 0 && (
                <span className="absolute bottom-2 right-3 text-[10px] text-slate-400 dark:text-slate-500">
                  {input.length}
                </span>
              )}
            </div>

            {isStreaming ? (
              <button
                id="stop-stream-btn"
                onClick={stopStream}
                title="Stop generation"
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow-sm"
              >
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : (
               <button
                id="send-btn"
                onClick={handleSend}
                disabled={!canSend}
                title="Send (Enter)"
                className={cn(
                  "flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-white shadow-sm",
                  canSend
                    ? mode === "plugin"
                      ? "bg-violet-600 hover:bg-violet-700"
                      : "bg-blue-600 hover:bg-blue-700"
                    : "bg-slate-200 dark:bg-slate-700 cursor-not-allowed opacity-50",
                )}
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>

          <p className="mt-1.5 text-center text-[10px] text-slate-500 dark:text-slate-600">
            {mode === "plugin"
              ? `Plugin mode · MC backend → openclaw channel plugin · board:${PLUGIN_BOARD_ID || "?"}`
              : `Direct SSE · MC backend → /v1/responses`}
          </p>
        </div>
      </div>
    </div>
  );
}
