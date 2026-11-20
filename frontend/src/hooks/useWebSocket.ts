import { useEffect, useRef, useState, useCallback } from 'react';
import { WSMessage } from '@/types/fleet';

export function useWebSocket(url: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectCountRef = useRef(0);
  const maxReconnectDelay = 30000;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    console.log(`Connecting to WS: ${url}`);
    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('WS Connected');
      setIsConnected(true);
      reconnectCountRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const parsed: WSMessage = JSON.parse(event.data);
        setLastMessage(parsed);
      } catch (e) {
        console.error('Failed to parse WS message', e);
      }
    };

    ws.onclose = () => {
      console.log('WS Disconnected');
      setIsConnected(false);
      const delay = Math.min(1000 * Math.pow(2, reconnectCountRef.current), maxReconnectDelay);
      reconnectCountRef.current++;
      setTimeout(connect, delay);
    };

    ws.onerror = (err) => {
      console.error('WS Error', err);
      ws.close();
    };

    wsRef.current = ws;
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback((msg: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
    }
  }, []);

  return { isConnected, lastMessage, sendMessage };
}
