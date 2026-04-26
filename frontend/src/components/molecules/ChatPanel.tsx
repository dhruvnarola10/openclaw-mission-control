"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, X, StopCircle, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOpenClawChat } from "@/hooks/useOpenClawChat";

interface ChatPanelProps {
  taskId: string;
  taskTitle: string;
  boardId: string;
  agentId?: string;
  taskContext?: string;
  onClose: () => void;
}

export function ChatPanel({
  taskId,
  taskTitle,
  boardId,
  agentId,
  taskContext,
  onClose,
}: ChatPanelProps) {
  const sessionKey = `mc-task-${taskId}`;
  const { messages, streamStatus, error, sendMessage, stopStream } =
    useOpenClawChat(sessionKey, boardId, agentId);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isStreaming = streamStatus === "streaming";
  const canSend = !!input.trim() && !isStreaming;

  // Auto-scroll to bottom on new tokens
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    void sendMessage(trimmed, taskContext);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col border-l border-slate-200 bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 shrink-0">
        <MessageSquare className="h-4 w-4 text-blue-500 shrink-0" />
        <span className="text-sm font-semibold text-slate-800 truncate flex-1">
          {taskTitle}
        </span>
        {agentId && (
          <span className="text-[10px] font-medium bg-blue-50 text-blue-600 rounded-full px-2 py-0.5 shrink-0">
            {agentId}
          </span>
        )}
        <button
          onClick={onClose}
          className="ml-1 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors shrink-0"
          aria-label="Close chat panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-3 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 shrink-0">
          <span className="font-semibold">Error: </span>
          {error}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-center text-sm text-slate-400 mt-8">
            Send a message to start working on this task with OpenClaw.
          </p>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex flex-col max-w-[90%] rounded-xl px-3 py-2 text-sm",
              msg.role === "user"
                ? "self-end bg-blue-600 text-white rounded-br-none"
                : msg.content.startsWith("⚠️")
                  ? "self-start bg-rose-50 border border-rose-200 text-rose-800 rounded-bl-none"
                  : msg.content.startsWith("✓")
                    ? "self-start bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-bl-none"
                    : "self-start bg-slate-100 text-slate-800 rounded-bl-none"
            )}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide opacity-60 mb-1">
              {msg.role === "user" ? "You" : "Assistant"}
            </div>
            <div className="whitespace-pre-wrap break-words leading-relaxed">
              {msg.content}
              {/* Blinking cursor while streaming this bubble */}
              {msg.role === "assistant" && isStreaming && msg.content === "" && (
                <span className="inline-block w-2 h-3.5 bg-slate-500 ml-0.5 align-middle animate-pulse" />
              )}
            </div>
            {msg.tokens != null && (
              <div className="mt-1 text-right text-[10px] opacity-50">
                {msg.tokens} tokens
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator for new response */}
        {isStreaming &&
          messages[messages.length - 1]?.role === "user" && (
            <div className="self-start flex items-center gap-1 bg-slate-100 rounded-xl rounded-bl-none px-3 py-2">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" />
            </div>
          )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-slate-200 p-3 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            placeholder="Message the agent… (Enter to send)"
            rows={1}
            className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 transition-all overflow-hidden"
          />
          {isStreaming ? (
            <button
              onClick={stopStream}
              className="flex items-center gap-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white px-3 py-2 text-sm font-medium transition-colors shrink-0"
            >
              <StopCircle className="h-4 w-4" />
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white transition-colors shrink-0",
                canSend
                  ? "bg-blue-600 hover:bg-blue-700"
                  : "bg-slate-300 cursor-not-allowed"
              )}
            >
              <Send className="h-4 w-4" />
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
