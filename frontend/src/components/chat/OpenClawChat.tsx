"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send, Settings, Square, ChevronDown, ChevronRight,
  Bot, Brain, Copy, Check, Trash2, X, Plus, Zap, MessageSquare, Radio, RefreshCw, Terminal,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { cn } from '@/lib/utils';
import styles from './openclaw-chat.module.css';

/* ─── Types ──────────────────────────────────────────────────────── */
interface Thread {
  id: string;
  title: string;
  sessionKey: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  streaming?: boolean;
  thinkingStreaming?: boolean;
  waiting?: boolean;
  isError?: boolean;
  isCommand?: boolean;
}

interface RemoteSession {
  key: string;
  channel: string;
  peer: string;
  agentId: string;
  kind?: string;
  updatedAt?: number;
}

interface ModelOption {
  id: string;
  label: string;
}

interface SlashCommand {
  cmd: string;
  desc: string;
  cat: string;
}

type WSStatus = 'off' | 'connecting' | 'on' | 'error';

/* ─── Helpers ────────────────────────────────────────────────────── */
const genId  = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const clip   = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s;
const relDay = (ts: number) => {
  const d = new Date(ts); d.setHours(0,0,0,0);
  const t = new Date();   t.setHours(0,0,0,0);
  const diff = Math.round((t.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff <= 7)  return 'Previous 7 days';
  if (diff <= 30) return 'Previous 30 days';
  return 'Older';
};

function groupThreads(threads: Thread[]): [string, Thread[]][] {
  const order = ['Today','Yesterday','Previous 7 days','Previous 30 days','Older'];
  const map: Record<string, Thread[]> = {};
  for (const t of [...threads].sort((a,b) => b.updatedAt - a.updatedAt)) {
    const g = relDay(t.updatedAt);
    (map[g] ??= []).push(t);
  }
  return order.filter(k => map[k]).map(k => [k, map[k]]);
}

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}

/* ─── Channel metadata ───────────────────────────────────────────── */
const CHANNELS: Record<string, { label: string; abbr: string; color: string }> = {
  telegram:  { label: 'Telegram',  abbr: 'TG', color: '#2AABEE' },
  slack:     { label: 'Slack',     abbr: 'SL', color: '#4A154B' },
  whatsapp:  { label: 'WhatsApp',  abbr: 'WA', color: '#25D366' },
  discord:   { label: 'Discord',   abbr: 'DC', color: '#5865F2' },
  signal:    { label: 'Signal',    abbr: 'SG', color: '#3A76F0' },
  imessage:  { label: 'iMessage',  abbr: 'iM', color: '#1DC855' },
  webchat:   { label: 'Web Chat',  abbr: 'WC', color: '#7c3aed' },
  web:       { label: 'Web',       abbr: 'WB', color: '#7c3aed' },
  internal:  { label: 'Internal',  abbr: 'IN', color: '#64748b' },
  main:      { label: 'Dashboard', abbr: 'DB', color: '#64748b' },
  email:     { label: 'Email',     abbr: 'EM', color: '#f59e0b' },
  sms:       { label: 'SMS',       abbr: 'SM', color: '#10b981' },
};
const channelMeta = (ch?: string) =>
  CHANNELS[ch?.toLowerCase() ?? ''] ?? { label: ch || 'Unknown', abbr: (ch||'??').slice(0,2).toUpperCase(), color: '#555' };

const ago = (ts?: number) => {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60000)    return 'just now';
  if (d < 3600000)  return `${Math.round(d/60000)}m ago`;
  if (d < 86400000) return `${Math.round(d/3600000)}h ago`;
  return `${Math.round(d/86400000)}d ago`;
};

/* Parse "agent:<agentId>:<channel>:<peer>" */
function parseKey(key = '') {
  const parts = key.split(':');
  if (parts[0] !== 'agent' || parts.length < 3) return { agentId: '?', channel: 'unknown', peer: key };
  return { agentId: parts[1], channel: parts[2], peer: parts.slice(3).join(':') || '—' };
}

/* ─── CSS module helper ──────────────────────────────────────────── */
const s = (name: string) => styles[name] ?? '';

/* ─── ENV ────────────────────────────────────────────────────────── */
const gatewayBase = process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_URL || 'http://localhost:18789';
const gatewayWS   = process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_WS_URL || 'ws://localhost:18789';
const ENV = {
  apiUrl:  `${gatewayBase}/v1/responses`,
  token:   process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_TOKEN || '',
  agentId: 'main',
  model:   'openclaw',
  stream:  true,
  wsUrl:   gatewayWS,
};

/* ─── Copy Button ────────────────────────────────────────────────── */
function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch {}
    setDone(true); setTimeout(() => setDone(false), 2000);
  };
  return (
    <button className={cn(s('copy-btn'), done && s('copied'))} onClick={copy}>
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? 'Copied!' : 'Copy'}
    </button>
  );
}

/* ─── Code Block ─────────────────────────────────────────────────── */
function CodeBlock({ language, children }: { language?: string; children: React.ReactNode }) {
  const code = String(children).replace(/\n$/, '');
  return (
    <div className={s('code-wrap')}>
      <div className={s('code-header')}>
        <span className={s('code-lang')}>{language || 'plaintext'}</span>
        <CopyBtn text={code} />
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={vscDarkPlus}
        PreTag="div"
        customStyle={{ margin:0, padding:'14px 16px', background:'#141414', fontSize:'13px', lineHeight:'1.6', borderRadius:'0 0 12px 12px' }}
        codeTagProps={{ style:{ fontFamily:"'SF Mono','Fira Code',Consolas,monospace" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

const mdComponents = {
  code({ className, children }: { className?: string; children?: React.ReactNode }) {
    const m = /language-(\w+)/.exec(className || '');
    return m ? <CodeBlock language={m[1]}>{children}</CodeBlock> : <code>{children}</code>;
  },
  pre({ children }: { children?: React.ReactNode }) { return <>{children}</>; },
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
};

/* ─── Thinking Block ─────────────────────────────────────────────── */
function ThinkingBlock({ content, streaming, expanded, onToggle }: {
  content: string; streaming?: boolean; expanded: boolean; onToggle: () => void;
}) {
  return (
    <div className={s('thinking')}>
      <button className={s('thinking-head')} onClick={onToggle}>
        <Brain size={13} />
        <span>{streaming ? 'Thinking…' : 'Thought process'}</span>
        <span className={s('thinking-spacer')} />
        {streaming && <span className={s('thinking-spinner')} />}
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {expanded && (
        <div className={s('thinking-body')}>
          <p>{content}{streaming && <span className={s('cursor')} />}</p>
        </div>
      )}
    </div>
  );
}

/* ─── Message ────────────────────────────────────────────────────── */
function Message({ msg, expanded, setExpanded }: {
  msg: ChatMessage;
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const id = msg.id;
  const toggle = useCallback(() => setExpanded(p => ({ ...p, [id]: !p[id] })), [id, setExpanded]);
  const isExpanded = expanded[id] === true;

  if (msg.role === 'user') {
    if (msg.isCommand) {
      return (
        <div className={cn(s('msg-row'), s('cmd-sent-row'))}>
          <span className={s('cmd-sent-pill')}>{msg.content}</span>
        </div>
      );
    }
    return (
      <div className={cn(s('msg-row'), s('user'))}>
        <div className={s('user-bubble')}>{msg.content}</div>
        <div className={cn(s('avatar'), s('avatar-user'))}>You</div>
      </div>
    );
  }

  if (msg.isCommand) {
    return (
      <div className={cn(s('msg-row'), s('system-row'))}>
        <div className={s('system-icon-wrap')}><Terminal size={13} /></div>
        <div className={s('system-bubble')}>
          {msg.waiting && !msg.content && (
            <div className={s('thinking-dots')} style={{ padding: '6px 0' }}>
              <span className={s('dot')} /><span className={s('dot')} /><span className={s('dot')} />
            </div>
          )}
          {msg.content && (
            <>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as never}>{msg.content}</ReactMarkdown>
              {msg.streaming && <span className={s('cursor')} />}
            </>
          )}
          {!msg.streaming && msg.content && (
            <div className={s('system-footer')}>system</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(s('msg-row'), s('assistant'))}>
      <div className={cn(s('avatar'), s('avatar-bot'))}><Bot size={16} /></div>
      <div className={s('asst')}>
        {(msg.thinking || msg.thinkingStreaming) && (
          <ThinkingBlock content={msg.thinking || ''} streaming={msg.thinkingStreaming} expanded={isExpanded} onToggle={toggle} />
        )}
        {msg.waiting && !msg.content && (
          <div className={s('thinking-dots')}>
            <span className={s('dot')} /><span className={s('dot')} /><span className={s('dot')} />
          </div>
        )}
        {msg.content && (
          <div className={cn(s('asst-msg'), msg.isError && s('error-msg'))}>
            {msg.isError
              ? <pre style={{ whiteSpace:'pre-wrap', fontFamily:'inherit' }}>{msg.content}</pre>
              : <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as never}>{msg.content}</ReactMarkdown>
            }
            {msg.streaming && <span className={s('cursor')} />}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Slash Commands ─────────────────────────────────────────────── */
const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/help',        desc: 'Show help summary',                              cat: 'Info'     },
  { cmd: '/commands',    desc: 'List all available commands',                    cat: 'Info'     },
  { cmd: '/status',      desc: 'Show runtime execution / quota info',            cat: 'Info'     },
  { cmd: '/whoami',      desc: 'Show your sender ID',                            cat: 'Info'     },
  { cmd: '/tools',       desc: 'Display agent capabilities',                     cat: 'Info'     },
  { cmd: '/usage',       desc: 'Show token usage and cost summary',              cat: 'Info'     },
  { cmd: '/context',     desc: 'Explain context assembly',                       cat: 'Info'     },
  { cmd: '/new',         desc: 'Start a new session',                            cat: 'Session'  },
  { cmd: '/reset',       desc: 'Reset session history',                          cat: 'Session'  },
  { cmd: '/compact',     desc: 'Compress session context',                       cat: 'Session'  },
  { cmd: '/stop',        desc: 'Abort the current run',                          cat: 'Session'  },
  { cmd: '/model',       desc: 'Show or set current model',                      cat: 'Model'    },
  { cmd: '/models',      desc: 'List available models and providers',            cat: 'Model'    },
  { cmd: '/think',       desc: 'Set thinking level (off / low / medium / high)', cat: 'Model'    },
  { cmd: '/fast',        desc: 'Toggle fast mode on or off',                     cat: 'Model'    },
  { cmd: '/reasoning',   desc: 'Toggle reasoning output visibility',             cat: 'Model'    },
  { cmd: '/elevated',    desc: 'Toggle elevated permission mode',                cat: 'Model'    },
  { cmd: '/verbose',     desc: 'Toggle verbose output',                          cat: 'Output'   },
  { cmd: '/trace',       desc: 'Toggle plugin trace output',                     cat: 'Output'   },
  { cmd: '/btw',         desc: 'Ask a side question without changing context',   cat: 'Advanced' },
  { cmd: '/skill',       desc: 'Run a skill by name',                            cat: 'Advanced' },
  { cmd: '/queue',       desc: 'Manage queue behavior',                          cat: 'Advanced' },
  { cmd: '/steer',       desc: 'Inject guidance into an active run',             cat: 'Advanced' },
  { cmd: '/subagents',   desc: 'Manage sub-agent runs',                          cat: 'Advanced' },
  { cmd: '/approve',     desc: 'Resolve exec approval prompts',                  cat: 'Advanced' },
  { cmd: '/config',      desc: 'Read or write openclaw.json config',             cat: 'Admin'    },
  { cmd: '/plugins',     desc: 'Inspect or mutate plugins',                      cat: 'Admin'    },
  { cmd: '/restart',     desc: 'Restart OpenClaw',                               cat: 'Admin'    },
  { cmd: '/diagnostics', desc: 'Generate a support diagnostics report',          cat: 'Admin'    },
  { cmd: '/bash',        desc: 'Run a shell command (requires bash enabled)',     cat: 'Admin'    },
];

/* ─── Main Component ─────────────────────────────────────────────── */
export function OpenClawChat() {
  /* Config */
  const [apiUrl,       setApiUrl]       = useState(() => load('oc-apiUrl',  ENV.apiUrl));
  const [token,        setToken]        = useState(() => load('oc-token',   ENV.token));
  const [agentId,      setAgentId]      = useState(() => load('oc-agentId', ENV.agentId));
  const [model,        setModel]        = useState(() => load('oc-model',   ENV.model));
  const [stream,       setStream]       = useState(() => load('oc-stream',  ENV.stream));
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => localStorage.setItem('oc-apiUrl',  JSON.stringify(apiUrl)),  [apiUrl]);
  useEffect(() => localStorage.setItem('oc-token',   JSON.stringify(token)),   [token]);
  useEffect(() => localStorage.setItem('oc-agentId', JSON.stringify(agentId)), [agentId]);
  useEffect(() => localStorage.setItem('oc-model',   JSON.stringify(model)),   [model]);
  useEffect(() => localStorage.setItem('oc-stream',  JSON.stringify(stream)),  [stream]);

  /* Models */
  const [models,        setModels]        = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError,   setModelsError]   = useState('');

  const fetchModels = useCallback(async (currentToken = token, currentApiUrl = apiUrl) => {
    setModelsLoading(true);
    setModelsError('');
    const base = currentApiUrl.replace(/\/responses$/, '').replace(/\/v1\//, '/v1/') || gatewayBase + '/v1';
    const url  = base.endsWith('/models') ? base : `${base}/models`;
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${currentToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = await res.json();
      const mapped: ModelOption[] = (data || [])
        .filter((m: { id?: string }) => m.id)
        .map((m: { id: string }) => ({ id: m.id, label: m.id }));
      setModels(mapped);
      if (mapped.length && !mapped.find(m => m.id === model)) setModel(mapped[0].id);
    } catch (e: unknown) {
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelsLoading(false);
    }
  }, [token, apiUrl, model]);

  useEffect(() => { fetchModels(); }, []); // eslint-disable-line
  const modelFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (modelFetchTimer.current) clearTimeout(modelFetchTimer.current);
    modelFetchTimer.current = setTimeout(() => fetchModels(token, apiUrl), 800);
  }, [token, apiUrl]); // eslint-disable-line

  /* Threads */
  const [threads,  setThreads]  = useState<Thread[]>(() => load('oc-threads', []));
  const [activeId, setActiveId] = useState<string | null>(() => load('oc-activeId', null));

  useEffect(() => localStorage.setItem('oc-threads',  JSON.stringify(threads)),  [threads]);
  useEffect(() => localStorage.setItem('oc-activeId', JSON.stringify(activeId)), [activeId]);

  const activeThread = useMemo(() => threads.find(t => t.id === activeId) || null, [threads, activeId]);
  const messages     = activeThread?.messages || [];
  const grouped      = useMemo(() => groupThreads(threads), [threads]);

  /* Sessions (WebSocket) */
  const [sidebarTab,     setSidebarTab]     = useState('threads');
  const [wsStatus,       setWsStatus]       = useState<WSStatus>('off');
  const [remoteSessions, setRemoteSessions] = useState<RemoteSession[]>([]);
  const wsRef          = useRef<WebSocket | null>(null);
  const wsRetry        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsActive       = useRef(false);
  const tokenRef       = useRef(token);
  const modelRef       = useRef(model);
  const historyPending = useRef(new Map<string, string>());
  const [loadingHistory, setLoadingHistory] = useState(new Set<string>());
  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { modelRef.current = model; }, [model]);

  const connectWS = useCallback(() => {
    if (wsActive.current) return;
    const state = wsRef.current?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;

    wsActive.current = true;
    if (wsRetry.current) clearTimeout(wsRetry.current);
    setWsStatus('connecting');

    const wsUrl  = load('oc-wsUrl', ENV.wsUrl);
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let authed = false;

    const req = (method: string, params: Record<string, unknown> = {}) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'req', id: genId(), method, params }));
    };

    const onAuthed = () => {
      authed = true;
      wsActive.current = false;
      setWsStatus('on');
      req('sessions.list');
      req('sessions.subscribe');
      req('models.list');
      pingTimer = setInterval(() => req('ping'), 20000);
    };

    const parseSessions = (payload: unknown) => {
      const p = payload as Record<string, unknown> | null;
      const raw = (p?.items ?? p?.sessions ?? (Array.isArray(payload) ? payload : null)) as unknown[] | null;
      if (!Array.isArray(raw)) return;
      setRemoteSessions(raw.map((item) => {
        const si = item as Record<string, unknown>;
        const parsed = parseKey((si.key as string) ?? '');
        return {
          key:       (si.key as string) ?? '',
          channel:   (si.channel as string)     || parsed.channel,
          peer:      (si.displayName as string)  || parsed.peer,
          agentId:   parsed.agentId,
          kind:      si.kind as string | undefined,
          updatedAt: si.updatedAt as number | undefined,
        };
      }));
    };

    socket.onopen = () => {
      setTimeout(() => { if (!authed) onAuthed(); }, 3000);
    };

    socket.onmessage = ({ data }: MessageEvent) => {
      try {
        const msg = JSON.parse(data as string) as Record<string, unknown>;

        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          socket.send(JSON.stringify({
            type: 'req', id: genId(), method: 'connect',
            params: {
              minProtocol: 3, maxProtocol: 3,
              client: { id: 'openclaw-control-ui', version: '1.0.0', platform: 'web', mode: 'ui' },
              auth: { token: tokenRef.current },
              scopes: ['operator.read', 'operator.write'],
            },
          }));
          return;
        }

        if (msg.type === 'res' && msg.ok && (msg.payload as Record<string, unknown>)?.type === 'hello-ok') {
          onAuthed();
          return;
        }

        if (msg.type === 'res' && msg.ok && Array.isArray((msg.payload as Record<string, unknown>)?.models)) {
          const payload = msg.payload as { models: Array<{ id: string; name: string; alias?: string }> };
          const mapped: ModelOption[] = payload.models.map(m => ({
            id:    m.id,
            label: m.alias ? `${m.name} (${m.alias})` : m.name,
          }));
          setModels(mapped);
          setModelsLoading(false);
          setModelsError('');
          if (mapped.length && !mapped.find(m => m.id === modelRef.current))
            setModel(mapped[0].id);
          return;
        }

        const msgId = msg.id as string | undefined;
        if (msgId && historyPending.current.has(msgId)) {
          const tId = historyPending.current.get(msgId)!;
          historyPending.current.delete(msgId);
          setLoadingHistory(p => { const ns = new Set(p); ns.delete(tId); return ns; });
          if (msg.ok) {
            const payload = msg.payload as Record<string, unknown>;
            const raw = (payload?.messages ?? payload?.items ?? []) as unknown[];
            const mapped = raw.flatMap((item) => {
              const entry = item as Record<string, unknown>;
              const m = (entry.message ?? entry) as Record<string, unknown>;
              if (!m?.role || m.role === 'tool' || m.role === 'toolResult') return [];
              let content = '', thinking = '';
              if (Array.isArray(m.content)) {
                for (const c of m.content as Array<Record<string, unknown>>) {
                  if (c.type === 'text') content += (c.text as string) ?? '';
                  else if (c.type === 'thinking' || c.type === 'reasoning')
                    thinking += (c.thinking as string) ?? (c.text as string) ?? '';
                }
              } else if (typeof m.content === 'string') {
                content = m.content;
              }
              if (!content && !thinking) return [];
              return [{ id: (entry.id ?? m.id ?? genId()) as string, role: m.role as 'user' | 'assistant', content, thinking: thinking || undefined }];
            });
            setThreads(prev => prev.map(t =>
              t.id === tId ? { ...t, messages: mapped, updatedAt: Date.now() } : t
            ));
          }
          return;
        }

        if (msg.type === 'res' && !msg.ok) {
          console.warn('[WS] error response:', msg.payload ?? msg);
          return;
        }

        if (msg.type === 'res' && msg.ok) {
          parseSessions(msg.payload);
        }

        if (msg.type === 'event' && authed) {
          req('sessions.list');
        }
      } catch {}
    };

    socket.onclose = () => {
      wsActive.current = false;
      if (pingTimer) clearInterval(pingTimer);
      setWsStatus('off');
      wsRetry.current = setTimeout(connectWS, 5000);
    };

    socket.onerror = () => { setWsStatus('error'); };
  }, []); // eslint-disable-line

  useEffect(() => {
    connectWS();
    return () => {
      if (wsRetry.current) clearTimeout(wsRetry.current);
      wsActive.current = false;
      wsRef.current?.close();
    };
  }, []); // eslint-disable-line

  /* UI state */
  const [input,            setInput]            = useState('');
  const [loading,          setLoading]          = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [editingTitle,     setEditingTitle]     = useState('');
  const [deletingId,       setDeletingId]       = useState<string | null>(null);

  /* Slash commands */
  const [slashIdx,       setSlashIdx]       = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const slashResults = useMemo(() => {
    if (!input.startsWith('/') || input.includes(' ')) return [];
    const q = input.slice(1).toLowerCase();
    return SLASH_COMMANDS.filter(c => c.cmd.slice(1).startsWith(q));
  }, [input]);
  const slashOpen = !slashDismissed && slashResults.length > 0;
  const slashPopupRef = useRef<HTMLDivElement>(null);

  /* Refs */
  const endRef      = useRef<HTMLDivElement>(null);
  const abortRef    = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const msgsRef     = useRef<HTMLDivElement>(null);
  const atBottom    = useRef(true);

  useEffect(() => {
    if (atBottom.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const onScroll = () => {
    const el = msgsRef.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  /* Thread helpers */
  const patchLast = useCallback((tId: string, fn: (m: ChatMessage) => ChatMessage) => {
    setThreads(prev => prev.map(t => {
      if (t.id !== tId) return t;
      const msgs = t.messages;
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== 'assistant') return t;
      return { ...t, updatedAt: Date.now(), messages: [...msgs.slice(0, -1), fn(last)] };
    }));
  }, []);

  const newThread = useCallback(() => {
    const current = threads.find(t => t.id === activeId);
    if (current && current.messages.length === 0) return;
    const id = genId();
    const thread: Thread = { id, title: '', sessionKey: `agent:${agentId}:web:${id}`, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    setThreads(prev => [thread, ...prev]);
    setActiveId(id);
    setExpandedThinking({});
    setInput('');
  }, [threads, activeId, agentId]);

  const switchThread = useCallback((id: string) => {
    setActiveId(id);
    setExpandedThinking({});
    atBottom.current = true;
  }, []);

  const deleteThread = useCallback((id: string) => {
    setThreads(prev => prev.filter(t => t.id !== id));
    if (activeId === id) {
      const remaining = threads.filter(x => x.id !== id);
      setActiveId(remaining[0]?.id || null);
    }
    setDeletingId(null);
  }, [activeId, threads]);

  const renameThread = useCallback((id: string, title: string) => {
    setThreads(prev => prev.map(t => t.id === id ? { ...t, title } : t));
    setEditingTitle('');
  }, []);

  const fetchHistory = useCallback((sessionKey: string, threadId: string) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    const reqId = genId();
    historyPending.current.set(reqId, threadId);
    setLoadingHistory(p => new Set([...p, threadId]));
    ws.send(JSON.stringify({
      type: 'req', id: reqId, method: 'chat.history',
      params: { sessionKey, limit: 200 },
    }));
  }, []);

  const joinSession = useCallback((sessionKey: string) => {
    const existing = threads.find(t => t.sessionKey === sessionKey);
    if (existing) {
      switchThread(existing.id);
      setSidebarTab('threads');
      fetchHistory(sessionKey, existing.id);
      return;
    }
    const { channel, peer } = parseKey(sessionKey);
    const meta  = channelMeta(channel);
    const id    = genId();
    const title = `${meta.label} · ${clip(peer, 24)}`;
    setThreads(prev => [{
      id, title, sessionKey,
      messages: [], createdAt: Date.now(), updatedAt: Date.now(),
    }, ...prev]);
    setActiveId(id);
    setExpandedThinking({});
    setSidebarTab('threads');
    fetchHistory(sessionKey, id);
  }, [threads, switchThread, fetchHistory]);

  /* Textarea grow */
  const grow = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  };
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    setSlashDismissed(false);
    setSlashIdx(0);
    grow();
  };
  const applySlash = useCallback((item: SlashCommand) => {
    setInput(item.cmd + ' ');
    setSlashDismissed(false);
    setSlashIdx(0);
    textareaRef.current?.focus();
    setTimeout(grow, 0);
  }, []);
  const setHint = (text: string) => { setInput(text); textareaRef.current?.focus(); setTimeout(grow, 0); };

  /* Send */
  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    atBottom.current = true;

    const existing = threads.find(t => t.id === activeId);
    const threadId         = existing?.id        || genId();
    const threadSessionKey = existing?.sessionKey || `agent:${agentId}:web:${threadId}`;
    const asstId           = genId();

    const isCommand = text.startsWith('/');
    const userMsg: ChatMessage = { id: genId(), role: 'user', content: text, isCommand };
    const asstMsg: ChatMessage = { id: asstId, role: 'assistant', content: '', thinking: '', streaming: true, thinkingStreaming: false, waiting: true, isError: false, isCommand };

    const titleText = isCommand ? '' : clip(text, 38);
    if (!existing) {
      setThreads(prev => [{
        id: threadId, title: titleText, sessionKey: threadSessionKey,
        messages: [userMsg, asstMsg], createdAt: Date.now(), updatedAt: Date.now(),
      }, ...prev]);
      setActiveId(threadId);
    } else {
      setThreads(prev => prev.map(t => t.id !== threadId ? t : {
        ...t,
        title: t.title || titleText,
        updatedAt: Date.now(),
        messages: [...t.messages, userMsg, asstMsg],
      }));
    }
    setExpandedThinking(p => ({ ...p, [asstId]: false }));
    setLoading(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-openclaw-agent-id': agentId,
          'x-openclaw-session-key': threadSessionKey,
        },
        body: JSON.stringify({ model, stream, input: text }),
        signal: abortRef.current.signal,
      });

      if (!res.ok)   throw new Error(`HTTP ${res.status} – ${res.statusText}`);
      if (!res.body) throw new Error('No response body');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '', evt = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const raw of lines) {
          const line = raw.trim();
          if (!line) { evt = ''; continue; }
          if (line.startsWith('event:')) { evt = line.slice(6).trim(); continue; }
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let parsed: Record<string, unknown>;
          try { parsed = JSON.parse(data); } catch { continue; }
          const type = (parsed.type || evt) as string;

          if (/thinking|reasoning/.test(type) && !type.includes('done')) {
            const d = (parsed.delta ?? parsed.thinking ?? parsed.reasoning ?? '') as string;
            if (d) patchLast(threadId, m => ({ ...m, thinking: (m.thinking||'') + d, thinkingStreaming: true, waiting: false }));
          }
          if (/thinking|reasoning/.test(type) && type.includes('done')) {
            patchLast(threadId, m => ({ ...m, thinkingStreaming: false }));
          }
          if (type === 'response.output_text.delta' && parsed.delta) {
            patchLast(threadId, m => ({ ...m, content: m.content + (parsed.delta as string), waiting: false, thinkingStreaming: false }));
          }
        }
      }
      patchLast(threadId, m => ({ ...m, streaming: false, thinkingStreaming: false, waiting: false }));

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        patchLast(threadId, m => ({ ...m, streaming: false, thinkingStreaming: false, waiting: false }));
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      patchLast(threadId, m => ({
        ...m,
        content: `${msg}\n\nCheck:\n• API running at ${apiUrl}\n• Bearer token correct\n• Agent ID valid`,
        streaming: false, thinkingStreaming: false, waiting: false, isError: true,
      }));
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIdx(i => Math.min(i + 1, slashResults.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIdx(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        applySlash(slashResults[slashIdx] ?? slashResults[0]);
        return;
      }
      if (e.key === 'Escape') {
        setSlashDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };
  const stop = () => abortRef.current?.abort();

  /* ─── Render ──────────────────────────────────────────────────── */
  return (
    <div className={s('app')}>

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className={s('sidebar')}>
        <div className={s('sb-brand')}>
          <div className={s('brand-icon')}><Zap size={15} /></div>
          <span className={s('brand-text')}>OpenClaw AI</span>
        </div>

        {/* Tabs */}
        <div className={s('sb-tabs')}>
          <button className={cn(s('sb-tab'), sidebarTab==='threads' && s('active'))} onClick={() => setSidebarTab('threads')}>
            <MessageSquare size={13} />Threads
          </button>
          <button className={cn(s('sb-tab'), sidebarTab==='sessions' && s('active'))} onClick={() => setSidebarTab('sessions')}>
            <Radio size={13} />
            Sessions
            <span className={cn(s('ws-dot'), s(`ws-${wsStatus}`))} title={wsStatus} />
          </button>
        </div>

        {sidebarTab === 'threads' ? (
          <>
            <div className={s('sb-new')} onClick={newThread}>
              <Plus size={15} /><span>New chat</span>
            </div>
            <div className={s('sb-threads')}>
              {threads.length === 0 && <div className={s('sb-empty')}>No conversations yet</div>}
              {grouped.map(([label, items]) => (
                <div key={label} className={s('sb-group')}>
                  <div className={s('sb-group-label')}>{label}</div>
                  {items.map(t => (
                    <div key={t.id} className={cn(s('sb-item'), t.id === activeId && s('active'))} onClick={() => switchThread(t.id)}>
                      <MessageSquare size={13} className={s('sb-item-icon')} />
                      <span className={s('sb-item-title')}>{t.title || 'New chat'}</span>
                      <button className={s('sb-item-del')} onClick={e => { e.stopPropagation(); setDeletingId(t.id); }} title="Delete">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className={s('sb-sessions')}>
            <div className={cn(s('ws-status'), s(`ws-status-${wsStatus}`))}>
              <span className={cn(s('ws-dot'), s(`ws-${wsStatus}`))} />
              {wsStatus === 'on'         && `Live · ${remoteSessions.length} session${remoteSessions.length!==1?'s':''}`}
              {wsStatus === 'connecting' && 'Connecting…'}
              {wsStatus === 'off'        && <><span>Disconnected</span><button className={s('ws-retry')} onClick={connectWS}>Retry</button></>}
              {wsStatus === 'error'      && <><span>Error</span><button className={s('ws-retry')} onClick={connectWS}>Retry</button></>}
            </div>

            {remoteSessions.length === 0 && wsStatus === 'on' && (
              <div className={s('sb-empty')}>No active sessions</div>
            )}

            {Object.entries(
              remoteSessions.reduce<Record<string, RemoteSession[]>>((acc, sess) => {
                (acc[sess.channel] ??= []).push(sess);
                return acc;
              }, {})
            ).map(([ch, sessions]) => {
              const meta = channelMeta(ch);
              return (
                <div key={ch} className={s('sb-group')}>
                  <div className={s('sb-group-label')} style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span className={s('ch-abbr')} style={{ background: meta.color }}>{meta.abbr}</span>
                    {meta.label}
                    <span className={s('sb-count')}>{sessions.length}</span>
                  </div>
                  {sessions.map(sess => {
                    const isLinked = threads.some(t => t.sessionKey === sess.key);
                    const isActive = isLinked && activeThread?.sessionKey === sess.key;
                    return (
                      <div key={sess.key} className={cn(s('sb-item'), isActive && s('active'))} onClick={() => joinSession(sess.key)} title={sess.key}>
                        <span className={s('ch-dot')} style={{ background: meta.color }} />
                        <span className={s('sb-item-title')}>{sess.peer || sess.key}</span>
                        <span className={s('sb-item-right')}>
                          {sess.kind && sess.kind !== 'main' && <span className={s('kind-badge')}>{sess.kind}</span>}
                          {sess.updatedAt && <span className={s('sess-time')}>{ago(sess.updatedAt)}</span>}
                          {isLinked && <span className={s('linked-badge')}>open</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </aside>

      {/* ── Workspace ───────────────────────────────────────────── */}
      <div className={s('workspace')}>

        {/* Chat header */}
        <div className={s('chat-header')}>
          <div className={s('chat-header-left')}>
            {editingTitle && activeThread ? (
              <input
                className={s('title-edit')}
                autoFocus
                defaultValue={activeThread.title}
                onBlur={e  => renameThread(activeThread.id, e.target.value.trim() || activeThread.title)}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') { setEditingTitle(''); }
                }}
              />
            ) : (
              <h1 className={s('chat-title')} onClick={() => activeThread && setEditingTitle('edit')} title="Click to rename">
                {activeThread?.title || 'OpenClaw AI'}
              </h1>
            )}
          </div>
          <div className={s('chat-header-right')}>
            {activeThread && (
              <span className={s('session-badge')} title={`Session: ${activeThread.sessionKey}`}>
                {activeThread.sessionKey.split(':').pop()?.slice(0, 8)}
              </span>
            )}
            {activeThread && (
              <button
                className={cn(s('icon-btn'), loadingHistory.has(activeId ?? '') && s('spinning'))}
                onClick={() => fetchHistory(activeThread.sessionKey, activeThread.id)}
                title="Refresh history"
                disabled={loadingHistory.has(activeId ?? '')}
              >
                <RefreshCw size={15} />
              </button>
            )}
            <button
              className={cn(s('icon-btn'), showSettings && s('active'))}
              onClick={() => setShowSettings(v => !v)}
              title="Settings"
            >
              <Settings size={17} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className={s('messages')} ref={msgsRef} onScroll={onScroll}>
          {loadingHistory.has(activeId ?? '') && messages.length === 0 ? (
            <div className={s('history-loading')}>
              <span className={s('hist-spinner')} />
              Loading conversation history…
            </div>
          ) : messages.length === 0 ? (
            <div className={s('empty')}>
              <div className={s('empty-icon')}><Bot size={28} /></div>
              <h2>OpenClaw AI</h2>
              <p>Your intelligent AI assistant. Ask anything to get started.</p>
              <div className={s('hints')}>
                {['What can you help me with?','Write a Python hello world','Explain quantum computing','Debug my code'].map(h => (
                  <button key={h} className={s('hint-chip')} onClick={() => setHint(h)}>{h}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className={s('messages-inner')}>
              {loadingHistory.has(activeId ?? '') && (
                <div className={s('history-refresh-bar')}>
                  <span className={s('hist-spinner')} /> Refreshing…
                </div>
              )}
              {messages.map(msg => (
                <Message key={msg.id} msg={msg} expanded={expandedThinking} setExpanded={setExpandedThinking} />
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className={s('input-area')}>
          <div className={s('input-wrap')}>
            {slashOpen && (
              <div className={s('slash-popup')} ref={slashPopupRef}>
                {slashResults.map((item, i) => (
                  <button
                    key={item.cmd}
                    className={cn(s('slash-item'), i === slashIdx && s('active'))}
                    onMouseDown={e => { e.preventDefault(); applySlash(item); }}
                    onMouseEnter={() => setSlashIdx(i)}
                  >
                    <span className={s('slash-cmd')}>{item.cmd}</span>
                    <span className={s('slash-desc')}>{item.desc}</span>
                    <span className={s('slash-cat')}>{item.cat}</span>
                  </button>
                ))}
                <div className={s('slash-footer')}>
                  <span>↑↓ navigate</span>
                  <span>↵ / Tab select</span>
                  <span>Esc dismiss</span>
                </div>
              </div>
            )}
            <div className={s('input-box')}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={onKey}
                placeholder="Message OpenClaw… (type / for commands)"
                className={s('chat-input')}
                rows={1}
                disabled={loading}
              />
              <div className={s('input-right')}>
                {loading
                  ? <button className={s('stop-btn')} onClick={stop} title="Stop"><Square size={16} /></button>
                  : <button className={s('send-btn')} onClick={() => void send()} disabled={!input.trim()} title="Send"><Send size={16} /></button>
                }
              </div>
            </div>
          </div>
          <div className={s('input-hint')}>Enter to send · Shift+Enter for new line · / for commands</div>
        </div>
      </div>

      {/* ── Settings Panel ──────────────────────────────────────── */}
      {showSettings && (
        <aside className={s('settings')}>
          <div className={s('settings-head')}>
            <h2>Configuration</h2>
            <button className={s('icon-btn')} onClick={() => setShowSettings(false)}><X size={16} /></button>
          </div>
          <div className={s('settings-body')}>
            <div className={s('field')}><label>API URL</label>
              <input type="text" value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="http://localhost:18789/v1/responses" />
            </div>
            <div className={s('field')}><label>Bearer Token</label>
              <textarea value={token} onChange={e => setToken(e.target.value)} rows={3} placeholder="Enter bearer token" />
            </div>
            <div className={s('field')}><label>Agent ID</label>
              <input type="text" value={agentId} onChange={e => setAgentId(e.target.value)} placeholder="main" />
            </div>
            <div className={s('field')}>
              <div className={s('field-label-row')}>
                <label>Model</label>
                <button
                  className={cn(s('refresh-btn'), modelsLoading && s('spinning'))}
                  onClick={() => fetchModels()}
                  disabled={modelsLoading}
                  title="Refresh model list"
                >
                  <RefreshCw size={11} />
                </button>
              </div>
              {models.length > 0 ? (
                <select
                  className={s('field-select')}
                  value={model}
                  onChange={e => setModel(e.target.value)}
                >
                  {models.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder="openclaw"
                  className={modelsLoading ? s('loading') : ''}
                />
              )}
              {modelsError && (
                <span className={s('field-err')}>Could not load models: {modelsError}</span>
              )}
              {modelsLoading && !modelsError && (
                <span className={s('field-hint')}>Fetching models…</span>
              )}
            </div>
            <div className={cn(s('field'), s('field-row'))}>
              <label>Streaming</label>
              <button className={cn(s('toggle-btn'), stream && s('on'))} onClick={() => setStream((v: boolean) => !v)}>
                {stream ? 'Enabled' : 'Disabled'}
              </button>
            </div>
            <div className={s('env-note')}>
              Defaults from env. Settings saved to localStorage.
            </div>
            <div className={s('status-card')}>
              <div className={s('status-card-title')}>Status</div>
              <div className={s('status-row')}><span className={cn(s('status-dot'), stream ? s('on') : s('off'))}/>&nbsp;Streaming {stream?'enabled':'disabled'}</div>
              <div className={s('status-row')}><span className={s('status-label')}>Model</span><span className={s('status-val')}>{model}</span></div>
              <div className={s('status-row')}><span className={s('status-label')}>Threads</span><span className={s('status-val')}>{threads.length}</span></div>
              <div className={s('status-row')}><span className={s('status-label')}>Messages</span><span className={s('status-val')}>{messages.length}</span></div>
            </div>
            <button className={s('clear-btn')} onClick={() => { setThreads([]); setActiveId(null); }}>
              <Trash2 size={14} />Clear All History
            </button>
          </div>
        </aside>
      )}

      {/* ── Delete confirm dialog ────────────────────────────────── */}
      {deletingId && (
        <div className={s('dialog-overlay')} onClick={() => setDeletingId(null)}>
          <div className={s('dialog')} onClick={e => e.stopPropagation()}>
            <h3>Delete conversation?</h3>
            <p>This will permanently remove the chat history. The server-side session will be unaffected.</p>
            <div className={s('dialog-actions')}>
              <button className={s('dialog-cancel')} onClick={() => setDeletingId(null)}>Cancel</button>
              <button className={s('dialog-confirm')} onClick={() => deleteThread(deletingId)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
