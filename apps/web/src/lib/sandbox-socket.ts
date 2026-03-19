import { appConfig } from './config';

export type SandboxInbound = {
  type: string;
  [key: string]: unknown;
};

type Listener = (event: SandboxInbound) => void;

function buildSocketUrl() {
  return `${appConfig.wsBaseUrl}/ws/sandbox`;
}

export class SandboxSocket {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private queue: string[] = [];
  private userId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionallyClosed = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  connect(userId: string) {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return;
    }
    this.userId = userId;
    this.intentionallyClosed = false;
    this.doConnect();
  }

  private doConnect() {
    if (!this.userId) return;

    this.socket = new WebSocket(buildSocketUrl());

    this.socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.send({ type: 'auth', user_id: this.userId });
      this.flushQueue();
      this.startHeartbeat();
    });

    this.socket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(String(event.data || '{}')) as SandboxInbound;
        this.emit(payload);
      } catch {
        this.emit({ type: 'error', message: '消息解析失败。' });
      }
    });

    this.socket.addEventListener('error', () => {
      // Suppress — close event will handle reconnect
    });

    this.socket.addEventListener('close', () => {
      this.socket = null;
      this.stopHeartbeat();
      if (this.intentionallyClosed) return;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 15000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionallyClosed && this.userId) {
        this.doConnect();
      }
    }, delay);
  }

  onEvent(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close() {
    this.intentionallyClosed = true;
    this.queue = [];
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.userId = null;
    this.reconnectAttempts = 0;
  }

  joinMatch(matchId: string) {
    this.send({ type: 'join_match', match_id: matchId });
  }

  fetchHistory(matchId: string, limit = 80) {
    this.send({ type: 'fetch_history', match_id: matchId, limit });
  }

  fetchWallState(matchId: string) {
    this.send({ type: 'wall_state', match_id: matchId });
  }

  sendSandboxMessage(matchId: string, text: string) {
    this.send({ type: 'sandbox_message', match_id: matchId, text });
  }

  sendDirectMessage(matchId: string, text: string) {
    this.send({ type: 'direct_message', match_id: matchId, text });
  }

  sendWallDecision(matchId: string, accept: boolean) {
    this.send({ type: 'wall_break_decision', match_id: matchId, accept });
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30_000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private send(payload: Record<string, unknown>) {
    const text = JSON.stringify(payload);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(text);
      return;
    }
    this.queue.push(text);
  }

  private flushQueue() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        this.socket.send(next);
      }
    }
  }

  private emit(event: SandboxInbound) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
