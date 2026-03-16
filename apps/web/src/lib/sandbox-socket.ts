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

  connect(userId: string) {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return;
    }

    this.socket = new WebSocket(buildSocketUrl());

    this.socket.addEventListener('open', () => {
      this.send({ type: 'auth', user_id: userId });
      this.flushQueue();
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
      this.emit({ type: 'error', message: '聊天连接异常，请稍后重试。' });
    });

    this.socket.addEventListener('close', () => {
      this.emit({ type: 'closed' });
      this.socket = null;
    });
  }

  onEvent(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close() {
    this.queue = [];
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
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
