"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/auth/clerk";

export interface GatewayConfig {
  url: string;   // ws://host:18789  (already ws:// scheme)
  token: string;
}

/**
 * Fetch the OpenClaw Gateway WebSocket URL + token from the MC backend.
 * Backend handles auth and board → gateway resolution.
 */
export function useGatewayConfig(boardId: string | undefined): GatewayConfig | null {
  const { getToken } = useAuth();
  const [config, setConfig] = useState<GatewayConfig | null>(null);

  useEffect(() => {
    if (!boardId) {
      setConfig(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(
          `/api/v1/gateways/chat/ws-config?board_id=${encodeURIComponent(boardId)}`,
          { headers }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.url) {
          setConfig({ url: data.url, token: data.token ?? "" });
        }
      } catch (e) {
        console.error("useGatewayConfig: failed to fetch ws-config", e);
      }
    };

    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  return config;
}
