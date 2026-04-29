"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  MessageSquarePlus,
  Send,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react";

import { useListBoardsApiV1BoardsGet } from "@/api/generated/boards/boards";
import { useAuth } from "@/auth/clerk";
import { cn } from "@/lib/utils";
import { useGatewayConfig } from "@/hooks/useGatewayConfig";
import { useOpenClawChat } from "@/hooks/useOpenClawChat";

// ── Helpers ───────────────────────────────────────────────────────────────────

function newSessionKey() {
  return "chat-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      onClick={handleCopy}
      title="Copy"
      className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0 p-1 rounded hover:bg-white/10"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-slate-400 hover:text-slate-200" />
      )}
    </button>
  );
}

// Simple inline code / bold / italic renderer without a heavy dep
function RenderText({ text }: { text: string }) {
  // Split on code blocks first
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const inner = part.slice(3, -3).replace(/^\w+\n/, "");
          return (
            <pre
              key={i}
              className="my-2 rounded-lg bg-black/30 px-3 py-2 text-xs font-mono overflow-x-auto whitespace-pre text-emerald-300"
            >
              {inner}
            </pre>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={i} className="rounded bg-black/30 px-1 py-0.5 text-xs font-mono text-amber-300">
              {part.slice(1, -1)}
            </code>
          );
        }
        // Render **bold** and *italic*
        const boldItalic = part.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
        return boldItalic.map((seg, j) => {
          if (seg.startsWith("**") && seg.endsWith("**")) {
            return <strong key={`${i}-${j}`}>{seg.slice(2, -2)}</strong>;
          }
          if (seg.startsWith("*") && seg.endsWith("*")) {
            return <em key={`${i}-${j}`}>{seg.slice(1, -1)}</em>;
          }
          return <span key={`${i}-${j}`}>{seg}</span>;
        });
      })}
    </>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ChatWindow() {
  const { isSignedIn } = useAuth();

  // ── Board selection ────────────────────────────────────────────────────────
  const { data: boardsData, isLoading: isLoadingBoards } =
    useListBoardsApiV1BoardsGet(undefined, {
      query: { enabled: Boolean(isSignedIn) },
    });
  const boards = boardsData?.status === 200 ? (boardsData.data.items ?? []) : [];

  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [sessionKey, setSessionKey] = useState<string>(newSessionKey);
  const [input, setInput] = useState<string>("");

  useEffect(() => {
    if (boards.length > 0 && !selectedBoardId) {
      setSelectedBoardId(boards[0].id);
    }
  }, [boards, selectedBoardId]);

  // ── Gateway config (for connection status indicator) ───────────────────────
  const gwConfig = useGatewayConfig(selectedBoardId || undefined);

  const wsStatus = gwConfig
    ? "connected"
    : selectedBoardId
    ? "connecting"
    : "disconnected";

  // ── SSE-based chat (uses /v1/responses via /api/v1/gateways/chat/stream) ───
  const { messages, streamStatus, error, sendMessage, stopStream } =
    useOpenClawChat(sessionKey, selectedBoardId || undefined);

  const isStreaming = streamStatus === "streaming";
  const canSend = !!input.trim() && !!selectedBoardId && !isStreaming;

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

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
    setSessionKey(newSessionKey());
  };

  // ── Status config ──────────────────────────────────────────────────────────
  const statusCfg = {
    connected: { dot: "bg-emerald-400", label: "Connected", Icon: Wifi },
    connecting: { dot: "bg-amber-400 animate-pulse", label: "Resolving…", Icon: Wifi },
    disconnected: { dot: "bg-slate-500", label: "Select a board", Icon: WifiOff },
  }[wsStatus];

  return (
    <div className="flex flex-col h-[calc(100vh-148px)] min-h-[520px] max-w-4xl mx-auto w-full">

      {/* ── Header bar ── */}
      <div className="shrink-0 rounded-t-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-t-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">

          {/* Left: brand + status */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-blue-600/20 border border-blue-500/30 shrink-0">
              <Bot className="h-4 w-4 text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-100 leading-none">OpenClaw Chat</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", statusCfg.dot)} />
                <span className="text-[11px] text-slate-400">{statusCfg.label}</span>
                <statusCfg.Icon className="h-3 w-3 text-slate-500" />
              </div>
            </div>
          </div>

          {/* Right: selectors + new chat */}
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {/* Board */}
            <div className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5">
              <span className="text-[11px] text-slate-400 font-medium">Board</span>
              {isLoadingBoards ? (
                <span className="text-xs text-slate-500">Loading…</span>
              ) : boards.length === 0 ? (
                <span className="text-xs text-rose-400">None</span>
              ) : (
                <select
                  id="board-select"
                  value={selectedBoardId}
                  onChange={(e) => setSelectedBoardId(e.target.value)}
                  className="bg-transparent text-xs text-slate-200 font-medium border-none outline-none cursor-pointer max-w-[140px]"
                >
                  {boards.map((b) => (
                    <option key={b.id} value={b.id} className="bg-slate-900">
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Session key badge */}
            <div className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5">
              <span className="text-[11px] text-slate-400 font-medium">Session</span>
              <span className="text-[11px] text-slate-300 font-mono truncate max-w-[100px]">
                {sessionKey}
              </span>
            </div>

            {/* New chat */}
            <button
              id="new-chat-btn"
              onClick={handleNewChat}
              title="Start new chat session"
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors shadow-sm"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              New Chat
            </button>
          </div>
        </div>
      </div>

      {/* ── Chat body ── */}
      <div className="flex flex-col flex-1 overflow-hidden border-x border-b border-slate-700 rounded-b-2xl bg-slate-950 shadow-xl">

        {/* Error banner */}
        {error && (
          <div className="shrink-0 mx-4 mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">
            <span className="font-semibold">Error: </span>{error}
          </div>
        )}

        {/* Messages list */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          {messages.length === 0 && !isStreaming && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-16">
              <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-blue-600/15 border border-blue-500/20">
                <Bot className="h-6 w-6 text-blue-400" />
              </div>
              <div>
                <p className="text-slate-300 font-medium text-sm">
                  {selectedBoardId ? "Start a conversation" : "Select a board to begin"}
                </p>
                <p className="text-slate-500 text-xs mt-1">
                  {selectedBoardId
                    ? "Messages stream via /v1/responses · Enter to send"
                    : "Choose a board from the dropdown above"}
                </p>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "group flex gap-2.5 max-w-[90%] md:max-w-[78%] animate-fade-in",
                msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
              )}
            >
              {/* Avatar */}
              {msg.role === "assistant" && (
                <div className="shrink-0 flex items-end">
                  <div className="h-7 w-7 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                    <Bot className="h-3.5 w-3.5 text-blue-400" />
                  </div>
                </div>
              )}

              {/* Bubble */}
              <div
                className={cn(
                  "relative flex flex-col rounded-2xl px-4 py-3 text-sm shadow-md",
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-tr-none"
                    : "bg-slate-800 border border-slate-700 text-slate-100 rounded-tl-none"
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="leading-relaxed whitespace-pre-wrap break-words flex-1">
                    {msg.role === "assistant" ? (
                      <RenderText text={msg.content} />
                    ) : (
                      msg.content
                    )}
                    {/* Streaming cursor on last assistant message */}
                    {isStreaming &&
                      msg.role === "assistant" &&
                      msg.id === messages[messages.length - 1]?.id && (
                        <span className="inline-block w-0.5 h-4 bg-blue-400 ml-0.5 animate-pulse align-middle" />
                      )}
                  </div>
                  <CopyButton text={msg.content} />
                </div>
              </div>
            </div>
          ))}

          {/* Typing dots (before first token arrives) */}
          {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex gap-2.5 mr-auto animate-fade-in">
              <div className="h-7 w-7 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
                <Bot className="h-3.5 w-3.5 text-blue-400" />
              </div>
              <div className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-2xl rounded-tl-none px-4 py-3">
                <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
                <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
                <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Input bar ── */}
        <div className="shrink-0 border-t border-slate-800 bg-slate-900/80 backdrop-blur px-4 py-3">
          <div className="flex gap-2 items-end">
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                id="chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!selectedBoardId || isStreaming}
                placeholder={
                  !selectedBoardId
                    ? "Select a board above to start chatting…"
                    : isStreaming
                    ? "Streaming response…"
                    : "Message OpenClaw… (Enter ↵ to send, Shift+Enter for newline)"
                }
                rows={1}
                className="w-full resize-none overflow-hidden rounded-xl border border-slate-700 bg-slate-800/60 text-slate-100 placeholder:text-slate-500 px-4 py-2.5 pr-12 text-sm focus:border-blue-500/60 focus:outline-none focus:ring-1 focus:ring-blue-500/30 disabled:opacity-40 transition-all"
              />
              {input.length > 0 && (
                <span className="absolute bottom-2 right-3 text-[10px] text-slate-500">
                  {input.length}
                </span>
              )}
            </div>

            {isStreaming ? (
              <button
                id="stop-stream-btn"
                onClick={stopStream}
                title="Stop generation"
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition-colors shadow-sm"
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
                  "flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-white transition-all shadow-sm",
                  canSend
                    ? "bg-blue-600 hover:bg-blue-500 hover:shadow-blue-500/30 hover:shadow-md"
                    : "bg-slate-700 cursor-not-allowed opacity-50"
                )}
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Footer hint */}
          <p className="mt-1.5 text-center text-[10px] text-slate-600">
            Powered by OpenClaw · /v1/responses SSE stream
          </p>
        </div>
      </div>
    </div>
  );
}
