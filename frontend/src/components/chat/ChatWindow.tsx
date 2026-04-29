"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Wifi, WifiOff } from "lucide-react";

import { useListBoardsApiV1BoardsGet } from "@/api/generated/boards/boards";
import { useAuth } from "@/auth/clerk";
import { cn } from "@/lib/utils";
import { useGatewayConfig } from "@/hooks/useGatewayConfig";
import { useGatewayWS } from "@/hooks/useGatewayWS";

const DEFAULT_SESSION_KEY = "agent:main:mc-global-chat";

export default function ChatWindow() {
  const { isSignedIn } = useAuth();

  // ── Board selection ─────────────────────────────────────────────────────
  const { data: boardsData, isLoading: isLoadingBoards } =
    useListBoardsApiV1BoardsGet(undefined, {
      query: { enabled: Boolean(isSignedIn) },
    });
  const boards = boardsData?.status === 200 ? (boardsData.data.items ?? []) : [];

  const [selectedBoardId, setSelectedBoardId]     = useState<string>("");
  const [selectedSessionKey, setSelectedSessionKey] = useState<string>(DEFAULT_SESSION_KEY);
  const [input, setInput]                           = useState<string>("");

  useEffect(() => {
    if (boards.length > 0 && !selectedBoardId) {
      setSelectedBoardId(boards[0].id);
    }
  }, [boards, selectedBoardId]);

  // ── Gateway config (URL + token) from backend ───────────────────────────
  const gwConfig = useGatewayConfig(selectedBoardId || undefined);

  // ── Direct WebSocket connection to OpenClaw Gateway ─────────────────────
  const { messages, wsStatus, isTyping, error, sendMessage } = useGatewayWS({
    config: gwConfig,
    sessionKey: selectedSessionKey,
  });

  // ── Auto-scroll ─────────────────────────────────────────────────────────
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const canSend = !!input.trim() && wsStatus === "connected" && !isTyping;

  const handleSend = () => {
    if (!canSend) return;
    void sendMessage(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Status indicator ─────────────────────────────────────────────────────
  const statusConfig = {
    connected:    { color: "bg-emerald-500", label: "Connected",   icon: Wifi },
    connecting:   { color: "bg-amber-400 animate-pulse", label: "Connecting…", icon: Wifi },
    disconnected: { color: "bg-slate-400", label: "Disconnected", icon: WifiOff },
    error:        { color: "bg-rose-500", label: "Error",         icon: WifiOff },
  }[wsStatus];
  const StatusIcon = statusConfig.icon;

  return (
    <div className="flex flex-col max-w-4xl mx-auto w-full h-[calc(100vh-180px)] min-h-[500px]">

      {/* ── Top bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 shrink-0">

        {/* Status pill */}
        <div className="flex items-center gap-2 text-xs text-slate-500 px-1">
          <span className={cn("h-2 w-2 rounded-full shrink-0", statusConfig.color)} />
          <StatusIcon className="h-3 w-3 opacity-60" />
          <span className="font-medium text-slate-600 dark:text-slate-400">
            {statusConfig.label}
          </span>
        </div>

        {/* Board + Session selectors */}
        <div className="flex flex-col md:flex-row md:items-center gap-4 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md px-3 py-1.5 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-medium whitespace-nowrap">Board:</span>
            {isLoadingBoards ? (
              <span className="text-slate-400">Loading…</span>
            ) : boards.length === 0 ? (
              <span className="text-rose-500">No boards</span>
            ) : (
              <select
                value={selectedBoardId}
                onChange={(e) => setSelectedBoardId(e.target.value)}
                className="border-none bg-transparent py-0 pl-1 pr-6 text-slate-700 dark:text-slate-300 font-medium focus:ring-0 text-sm cursor-pointer max-w-[160px] truncate"
              >
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="hidden md:block w-px h-4 bg-slate-200 dark:bg-slate-700" />

          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-medium whitespace-nowrap">Session:</span>
            <select
              value={selectedSessionKey}
              onChange={(e) => setSelectedSessionKey(e.target.value)}
              className="border-none bg-transparent py-0 pl-1 pr-6 text-slate-700 dark:text-slate-300 font-medium focus:ring-0 text-sm cursor-pointer max-w-[200px] truncate"
            >
              <option value="agent:main:mc-global-chat">Global Chat</option>
              <option value="agent:main">Main</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 shrink-0 shadow-sm">
          <span className="font-semibold">Error: </span>{error}
        </div>
      )}

      {/* ── Chat area ── */}
      <div className="flex flex-col flex-1 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-4 bg-slate-50 dark:bg-slate-950">

          {messages.length === 0 && !isTyping && (
            <div className="flex h-full items-center justify-center text-slate-400 text-sm text-center px-4">
              {wsStatus === "connected"
                ? "Start a conversation with OpenClaw"
                : wsStatus === "connecting"
                ? "Connecting to gateway…"
                : "Select a board to connect"}
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex flex-col max-w-[92%] md:max-w-[78%] rounded-2xl px-4 py-3 text-sm shadow-sm",
                msg.role === "user"
                  ? "self-end bg-blue-600 text-white rounded-br-none"
                  : "self-start bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-bl-none"
              )}
            >
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">
                {msg.role === "user" ? "You" : "OpenClaw"}
              </div>
              <div className="whitespace-pre-wrap break-words leading-relaxed">
                {msg.content}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {isTyping && (
            <div className="self-start flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-bl-none shadow-sm px-4 py-3">
              <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" />
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 md:p-4 shrink-0">
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={wsStatus !== "connected" || isTyping}
              placeholder={
                wsStatus === "connected"
                  ? "Ask OpenClaw… (Enter to send)"
                  : wsStatus === "connecting"
                  ? "Connecting…"
                  : "Select a board to connect"
              }
              rows={1}
              className="flex-1 resize-none overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent dark:text-slate-200 px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-all w-full"
            />
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                "flex h-[42px] w-[42px] items-center justify-center rounded-lg text-white transition-colors shadow-sm shrink-0",
                canSend ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-300 cursor-not-allowed"
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
