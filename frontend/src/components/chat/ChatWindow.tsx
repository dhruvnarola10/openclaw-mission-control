"use client";

import { useEffect, useRef, useState } from "react";
import { Send, StopCircle } from "lucide-react";

import { useListBoardsApiV1BoardsGet } from "@/api/generated/boards/boards";
import { useOpenClawChat } from "@/hooks/useOpenClawChat";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth/clerk";

export default function ChatWindow() {
  const { isSignedIn, getToken } = useAuth();
  const { data: boardsData, isLoading: isLoadingBoards } = useListBoardsApiV1BoardsGet(
    undefined,
    {
      query: {
        enabled: Boolean(isSignedIn),
      },
    }
  );
  
  const boards = boardsData?.status === 200 ? (boardsData.data.items ?? []) : [];
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string>("mc-global-chat");
  const [slashCommands, setSlashCommands] = useState<any[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  useEffect(() => {
    if (boards.length > 0 && !selectedBoardId) {
      setSelectedBoardId(boards[0].id);
    }
  }, [boards, selectedBoardId]);

  useEffect(() => {
    if (!selectedBoardId) return;
    
    const load = async () => {
      setIsLoadingSessions(true);
      try {
        const token = await getToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        
        // Fetch Sessions
        fetch(`/api/v1/gateways/chat/sessions?board_id=${selectedBoardId}`, { headers })
          .then(r => r.json())
          .then(d => {
            if (d && d.sessions) setSessions(d.sessions);
          })
          .catch(e => console.error(e))
          .finally(() => setIsLoadingSessions(false));
          
        // Fetch Slash Commands
        fetch(`/api/v1/gateways/chat/slash-commands?board_id=${selectedBoardId}`, { headers })
          .then(r => r.json())
          .then(d => {
            if (d && Array.isArray(d)) setSlashCommands(d);
          })
          .catch(e => console.error(e));
      } catch (e) {
        console.error(e);
        setIsLoadingSessions(false);
      }
    };
    
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBoardId]);

  const handleBoardChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedBoardId(e.target.value);
  };

  const handleSessionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedSessionKey(e.target.value);
  };

  const sessionKey = selectedSessionKey;

  // Group sessions by appId or infer from key
  const groupedSessions = sessions.reduce((acc: Record<string, any[]>, s: any) => {
    let group = s.appId;
    if (!group) {
      if (s.key?.startsWith('agent:')) {
        group = s.key.split(':')[1];
      } else {
        group = 'Other';
      }
    }
    // Pretty print the gateway agent group name
    if (group.startsWith('mc-gateway-') || s.key === 'gateway') {
      group = `OpenClaw Gateway Agent (${group})`;
    }
    if (!acc[group]) acc[group] = [];
    acc[group].push(s);
    return acc;
  }, {});

  const { messages, streamStatus, error, sendMessage, stopStream } =
    useOpenClawChat(sessionKey, selectedBoardId);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isStreaming = streamStatus === "streaming";
  const canSend = !!input.trim() && !isStreaming && !!selectedBoardId;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming || !selectedBoardId) return;
    void sendMessage(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col max-w-4xl mx-auto w-full h-[calc(100vh-180px)] min-h-[500px]">
      {/* Status bar & Board Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 shrink-0">
        <div className="flex items-center gap-2 text-xs text-slate-500 px-1">
          <span className={cn(
            "h-2 w-2 rounded-full shrink-0",
            isStreaming ? "bg-amber-400 animate-pulse" : "bg-emerald-500"
          )} />
          <span className="font-medium text-slate-600 dark:text-slate-400">
            {isStreaming ? 'Waiting for reply…' : 'Ready'}
          </span>
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-4 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md px-3 py-1.5 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">Active Board:</span>
            {isLoadingBoards ? (
              <span className="text-slate-400">Loading...</span>
            ) : boards.length === 0 ? (
              <span className="text-rose-500">No boards</span>
            ) : (
              <select
                value={selectedBoardId}
                onChange={handleBoardChange}
                className="border-none bg-transparent py-0 pl-1 pr-6 text-slate-700 dark:text-slate-300 font-medium focus:ring-0 text-sm cursor-pointer max-w-[150px] truncate"
                disabled={isStreaming}
              >
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="hidden md:block w-px h-4 bg-slate-200 dark:bg-slate-700"></div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">Session:</span>
            {isLoadingSessions ? (
              <span className="text-slate-400">Loading...</span>
            ) : (
              <select
                value={selectedSessionKey}
                onChange={handleSessionChange}
                className="border-none bg-transparent py-0 pl-1 pr-6 text-slate-700 dark:text-slate-300 font-medium focus:ring-0 text-sm cursor-pointer max-w-[200px] truncate"
                disabled={isStreaming}
              >
                <option value="mc-global-chat">Global Chat</option>
                {Object.entries(groupedSessions).map(([groupName, groupSessions]: [string, any]) => (
                  <optgroup key={groupName} label={groupName}>
                    {groupSessions.map((s: any) => (
                      <option key={s.key} value={s.key}>
                        {s.label || s.key.replace(/^agent:[^:]+:/, '')}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 md:p-4 text-sm text-rose-800 shrink-0 shadow-sm">
          <span className="font-semibold text-rose-900">Error: </span>
          {error}
        </div>
      )}

      <div className="flex flex-col flex-1 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 md:p-5 space-y-4 bg-slate-50 dark:bg-slate-950">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center text-slate-400 text-sm text-center px-4">
              {!selectedBoardId && !isLoadingBoards
                ? 'You need access to a board to start chatting.'
                : 'Type a message below to start chatting with OpenClaw.'}
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex flex-col max-w-[92%] md:max-w-[78%] rounded-2xl px-4 py-3 text-sm shadow-sm",
                msg.role === "user"
                  ? "self-end bg-blue-600 text-white rounded-br-none"
                  : msg.content.startsWith("⚠️")
                    ? "self-start bg-rose-50 border border-rose-200 text-rose-800 rounded-bl-none"
                    : msg.content.startsWith("✓")
                      ? "self-start bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-bl-none"
                      : "self-start bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-bl-none"
              )}
            >
              <div className="mb-1.5 text-[10px] md:text-[11px] font-semibold uppercase tracking-wider opacity-60">
                {msg.role === "user" ? "You" : "Assistant"}
              </div>
              <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                {msg.content}
                {msg.role === "assistant" && isStreaming && msg.content === "" && (
                  <span className="ml-1 inline-block h-4 w-2.5 animate-pulse bg-slate-400 align-middle" />
                )}
              </div>
              {msg.tokens != null && (
                <div className="mt-2 text-right text-[11px] opacity-50">
                  {msg.tokens} tokens
                </div>
              )}
            </div>
          ))}

          {isStreaming && messages[messages.length - 1]?.role === "user" && (
            <div className="self-start flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-bl-none shadow-sm px-4 py-3">
              <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" />
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 md:p-4 shrink-0 relative">
          {input.startsWith("/") && slashCommands.length > 0 && (
             <ul className="absolute bottom-full left-4 mb-2 w-80 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-10 divide-y divide-slate-100 dark:divide-slate-700">
                {slashCommands.filter(c => ("/" + c.name).startsWith(input.toLowerCase())).length > 0 ? (
                  slashCommands.filter(c => ("/" + c.name).startsWith(input.toLowerCase())).map(cmd => (
                    <li 
                      key={cmd.name} 
                      className="p-3 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-colors" 
                      onClick={() => {
                        setInput("/" + cmd.name + " ");
                        textareaRef.current?.focus();
                      }}
                    >
                      <div className="font-bold text-sm text-indigo-600 dark:text-indigo-400">/{cmd.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{cmd.description}</div>
                    </li>
                  ))
                ) : (
                  <li className="p-3 text-xs text-slate-400">No matching commands.</li>
                )}
             </ul>
          )}
          <div className="flex gap-2 flex-col sm:flex-row items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming || !selectedBoardId}
              placeholder={
                selectedBoardId
                  ? "Ask OpenClaw… (Enter to send)"
                  : "Select a board to chat"
              }
              rows={1}
              className="flex-1 resize-none overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent dark:text-slate-200 px-4 py-2.5 text-base md:text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-all w-full"
            />
            {isStreaming ? (
              <button
                onClick={stopStream}
                className="flex h-[42px] w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-rose-500 px-5 font-medium text-white transition-colors hover:bg-rose-600 shrink-0"
              >
                <StopCircle className="h-4 w-4" />
                Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                className={cn(
                  "flex h-[42px] w-full sm:w-auto items-center justify-center gap-2 rounded-lg px-6 font-medium text-white transition-colors shadow-sm shrink-0",
                  canSend
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "cursor-not-allowed bg-slate-300"
                )}
              >
                <Send className="h-4 w-4" />
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
