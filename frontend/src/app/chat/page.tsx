"use client";

import { useState } from 'react';
import { useGatewayChat } from '../../hooks/useGatewayChat';

export default function ChatPage() {
  const { messages, send, status } = useGatewayChat();
  const [input, setInput] = useState('');

  // Show a helpful banner the first time the page loads if there is no token yet
  const tokenMissing = typeof window !== 'undefined' && 
    !process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_TOKEN && 
    !localStorage.getItem('openclawGatewayToken');

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    send(trimmed);
    setInput('');
  };

  // -----------------------------------------------------------------
  // UI
  // -----------------------------------------------------------------
  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <h2>🗨️ OpenClaw Local Chat</h2>

      {/* Token‑bootstrap UI */}
      {tokenMissing && (
        <div style={{ padding: '1rem', background: '#fffbdd', border: '1px solid #e0c000' }}>
          <p>
            <strong>OpenClaw token missing.</strong> Copy the token you generated with
            <code>openclaw gateway token generate</code> and paste it below.
          </p>
          <input
            type="text"
            placeholder="Paste gateway token here"
            onBlur={e => {
              const t = e.target.value.trim();
              if (t) localStorage.setItem('openclawGatewayToken', t);
            }}
            style={{ width: '100%', padding: '0.5rem' }}
          />
        </div>
      )}

      {/* Connection status */}
      <p>
        <em>Connection status: </em>
        <span style={{ color:
          status === 'open' ? 'green' :
          status === 'connecting' ? 'orange' : 'red' }}>
          {status}
        </span>
      </p>

      {/* Message transcript */}
      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: '4px',
          padding: '1rem',
          minHeight: '300px',
          background: '#fafafa',
        }}
      >
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: '0.6rem' }}>
            <strong>{m.role === 'user' ? 'You' : 'Assistant'}:</strong>{' '}
            <span>{m.text}</span>
          </div>
        ))}
        {status === 'open' && messages.length === 0 && (
          <p style={{ color: '#777' }}>Type a prompt below to start chatting.</p>
        )}
      </div>

      {/* Input box */}
      <div style={{ display: 'flex', marginTop: '1rem' }}>
        <input
          type="text"
          value={input}
          placeholder="Ask OpenClaw..."
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          style={{ flex: 1, padding: '0.5rem' }}
        />
        <button onClick={handleSend} style={{ marginLeft: '0.5rem', padding: '0.5rem 1rem' }}>
          Send
        </button>
      </div>
    </div>
  );
}
