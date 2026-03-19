import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Server } from 'http';
import { NativeWebSocketServer } from './native-websocket.server';
import { SandboxService } from './sandbox.service';

interface ConnectionState {
  userId: string | null;
  matchId: string | null;
}

interface AuthEvent {
  type: 'auth';
  user_id?: string;
}

interface JoinMatchEvent {
  type: 'join_match';
  match_id?: string;
}

interface SandboxMessageEvent {
  type: 'sandbox_message';
  match_id?: string;
  text?: string;
}

interface DirectMessageEvent {
  type: 'direct_message';
  match_id?: string;
  text?: string;
}

interface FetchHistoryEvent {
  type: 'fetch_history';
  match_id?: string;
  limit?: number;
}

interface WallDecisionEvent {
  type: 'wall_break_decision';
  match_id?: string;
  accept?: boolean;
}

interface WallStateEvent {
  type: 'wall_state';
  match_id?: string;
}

interface PingEvent {
  type: 'ping';
}

type InboundEvent =
  | AuthEvent
  | JoinMatchEvent
  | SandboxMessageEvent
  | DirectMessageEvent
  | FetchHistoryEvent
  | WallDecisionEvent
  | WallStateEvent
  | PingEvent;

@Injectable()
export class SandboxGatewayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SandboxGatewayService.name);
  private readonly connections = new Map<string, ConnectionState>();
  private readonly userConnections = new Map<string, Set<string>>();
  private socketServer: NativeWebSocketServer | null = null;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly sandboxService: SandboxService,
  ) {}

  onModuleInit() {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer() as Server;
    this.socketServer = new NativeWebSocketServer('/ws/sandbox', {
      onConnect: (clientId) => {
        this.connections.set(clientId, {
          userId: null,
          matchId: null,
        });
        this.send(clientId, {
          type: 'connected',
          connection_id: clientId,
        });
      },
      onClose: (clientId) => {
        this.removeConnection(clientId);
      },
      onMessage: async (clientId, payload) => {
        await this.handleInboundEvent(clientId, payload);
      },
    });
    this.socketServer.attach(httpServer);
  }

  onModuleDestroy() {
    this.socketServer?.close();
    this.socketServer = null;
    this.connections.clear();
    this.userConnections.clear();
  }

  private async handleInboundEvent(clientId: string, payload: unknown) {
    try {
      const event = payload as InboundEvent;
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
        this.send(clientId, { type: 'error', message: '无法识别的消息格式。' });
        return;
      }

    if (event.type === 'ping') {
      this.send(clientId, { type: 'pong', ts: new Date().toISOString() });
      return;
    }

    if (event.type === 'auth') {
      await this.handleAuth(clientId, event);
      return;
    }

    if (event.type === 'join_match') {
      await this.handleJoinMatch(clientId, event);
      return;
    }

    if (event.type === 'fetch_history') {
      await this.handleFetchHistory(clientId, event);
      return;
    }

    if (event.type === 'sandbox_message') {
      await this.handleSandboxMessage(clientId, event);
      return;
    }

    if (event.type === 'direct_message') {
      await this.handleDirectMessage(clientId, event);
      return;
    }

    if (event.type === 'wall_break_decision') {
      await this.handleWallBreakDecision(clientId, event);
      return;
    }

    if (event.type === 'wall_state') {
      await this.handleWallState(clientId, event);
      return;
    }

    this.send(clientId, { type: 'error', message: '不支持的事件类型。' });
    } catch (e: any) {
      this.send(clientId, { type: 'error', message: e.message || '处理消息时发生未知错误。' });
    }
  }

  private async handleAuth(clientId: string, event: AuthEvent) {
    const userId = event.user_id?.trim();
    if (!userId) {
      this.send(clientId, { type: 'error', message: '鉴权失败：缺少用户 ID。' });
      return;
    }

    const exists = await this.sandboxService.ensureUserExists(userId);
    if (!exists) {
      this.send(clientId, { type: 'error', message: '鉴权失败：用户不存在。' });
      return;
    }

    const state = this.connections.get(clientId);
    if (!state) {
      this.send(clientId, { type: 'error', message: '连接状态异常，请重新连接。' });
      return;
    }

    const previousUser = state.userId;
    if (previousUser && previousUser !== userId) {
      this.removeUserConnection(previousUser, clientId);
    }

    state.userId = userId;
    this.addUserConnection(userId, clientId);

    this.send(clientId, {
      type: 'auth_ok',
      user_id: userId,
    });
  }

  private async handleJoinMatch(clientId: string, event: JoinMatchEvent) {
    const state = this.connections.get(clientId);
    if (!state?.userId) {
      this.send(clientId, { type: 'error', message: '请先完成登录鉴权。' });
      return;
    }

    const matchId = event.match_id?.trim();
    if (!matchId) {
      this.send(clientId, { type: 'error', message: '缺少会话 ID。' });
      return;
    }

    const info = await this.sandboxService.assertMatchParticipant(matchId, state.userId);
    const wallState = await this.sandboxService.getWallState(matchId, state.userId);
    state.matchId = matchId;

    // Check if counterpart is online (has active connections)
    const counterpartOnline = this.isUserOnline(info.counterpart_user_id);

    this.send(clientId, {
      type: 'join_ok',
      match_id: matchId,
      counterpart_user_id: info.counterpart_user_id,
      status: info.status,
      resonance_score: info.resonance_score,
      wall_ready: wallState.wallReady,
      wall_broken: wallState.wallBroken,
      requester_accepted: wallState.requesterAccepted,
      counterpart_accepted: wallState.counterpartAccepted,
      counterpart_profile: wallState.counterpartProfile,
      self_profile: wallState.selfProfile,
    });

    // Notify peer online/offline status
    if (!counterpartOnline) {
      this.send(clientId, {
        type: 'peer_offline',
        match_id: matchId,
      });
    }

    // Notify counterpart that this user is now online
    this.sendToUser(info.counterpart_user_id, {
      type: 'peer_online',
      match_id: matchId,
      user_id: state.userId,
    });
  }

  private async handleFetchHistory(clientId: string, event: FetchHistoryEvent) {
    const state = this.connections.get(clientId);
    if (!state?.userId) {
      this.send(clientId, { type: 'error', message: '请先完成登录鉴权。' });
      return;
    }

    const matchId = event.match_id?.trim() || state.matchId || '';
    if (!matchId) {
      this.send(clientId, { type: 'error', message: '缺少会话 ID。' });
      return;
    }

    const limit =
      typeof event.limit === 'number' && Number.isFinite(event.limit)
        ? Math.max(1, Math.min(200, Math.round(event.limit)))
        : 50;

    const history = await this.sandboxService.getMatchMessages(matchId, state.userId, limit);
    this.send(clientId, {
      type: 'history',
      match_id: history.match_id,
      total: history.total,
      messages: history.messages,
    });
  }

  private async handleWallState(clientId: string, event: WallStateEvent) {
    const state = this.connections.get(clientId);
    if (!state?.userId) {
      this.send(clientId, { type: 'error', message: '请先完成登录鉴权。' });
      return;
    }

    const matchId = event.match_id?.trim() || state.matchId || '';
    if (!matchId) {
      this.send(clientId, { type: 'error', message: '缺少会话 ID。' });
      return;
    }

    const wallState = await this.sandboxService.getWallState(matchId, state.userId);
    this.send(clientId, {
      type: 'wall_state',
      match_id: wallState.matchId,
      status: wallState.status,
      resonance_score: wallState.resonanceScore,
      wall_ready: wallState.wallReady,
      wall_broken: wallState.wallBroken,
      requester_accepted: wallState.requesterAccepted,
      counterpart_accepted: wallState.counterpartAccepted,
      consents: wallState.consents,
      counterpart_profile: wallState.counterpartProfile,
      self_profile: wallState.selfProfile,
    });
  }

  private async handleWallBreakDecision(clientId: string, event: WallDecisionEvent) {
    const state = this.connections.get(clientId);
    if (!state?.userId) {
      this.send(clientId, { type: 'error', message: '请先完成登录鉴权。' });
      return;
    }

    const matchId = event.match_id?.trim() || state.matchId || '';
    if (!matchId) {
      this.send(clientId, { type: 'error', message: '缺少会话 ID。' });
      return;
    }
    const accept = event.accept === true;

    const requesterState = await this.sandboxService.submitWallDecision({
      matchId,
      userId: state.userId,
      accept,
    });

    const counterpartUserId = requesterState.counterpartProfile.userId;
    const counterpartState = await this.sandboxService.getWallState(
      requesterState.matchId,
      counterpartUserId,
    );

    const type = requesterState.wallBroken ? 'wall_broken' : 'wall_break_update';

    this.sendToUser(requesterState.selfProfile.userId, {
      type,
      match_id: requesterState.matchId,
      status: requesterState.status,
      resonance_score: requesterState.resonanceScore,
      wall_ready: requesterState.wallReady,
      wall_broken: requesterState.wallBroken,
      requester_accepted: requesterState.requesterAccepted,
      counterpart_accepted: requesterState.counterpartAccepted,
      consents: requesterState.consents,
      counterpart_profile: requesterState.counterpartProfile,
      self_profile: requesterState.selfProfile,
    });

    this.sendToUser(counterpartState.selfProfile.userId, {
      type,
      match_id: counterpartState.matchId,
      status: counterpartState.status,
      resonance_score: counterpartState.resonanceScore,
      wall_ready: counterpartState.wallReady,
      wall_broken: counterpartState.wallBroken,
      requester_accepted: counterpartState.requesterAccepted,
      counterpart_accepted: counterpartState.counterpartAccepted,
      consents: counterpartState.consents,
      counterpart_profile: counterpartState.counterpartProfile,
      self_profile: counterpartState.selfProfile,
    });
  }

  private async handleSandboxMessage(clientId: string, event: SandboxMessageEvent) {
    const state = this.connections.get(clientId);
    if (!state?.userId) {
      this.send(clientId, { type: 'error', message: '请先完成登录鉴权。' });
      return;
    }

    const matchId = event.match_id?.trim() || state.matchId || '';
    const text = event.text?.trim() || '';
    if (!matchId) {
      this.send(clientId, { type: 'error', message: '缺少会话 ID。' });
      return;
    }
    if (!text) {
      this.send(clientId, { type: 'error', message: '消息内容不能为空。' });
      return;
    }

    const result = await this.sandboxService.processMessage({
      matchId,
      senderId: state.userId,
      text,
    });

    state.matchId = matchId;

    if (!result.delivered) {
      this.send(clientId, {
        type: 'message_blocked',
        mode: 'sandbox',
        match_id: result.matchId,
        message_id: result.messageId,
        original_text: result.originalText,
        ai_action: result.aiAction,
        reason: result.reason,
        hidden_tag_updates: result.hiddenTagUpdates,
        created_at: result.createdAt,
      });
      return;
    }

    this.send(clientId, {
      type: 'message_delivered',
      mode: 'sandbox',
      match_id: result.matchId,
      message_id: result.messageId,
      sender_id: result.senderId,
      receiver_id: result.receiverId,
      original_text: result.originalText,
      text: result.rewrittenText,
      sender_summary: result.senderSummary,
      ai_action: result.aiAction,
      resonance_score: result.resonanceScore,
      created_at: result.createdAt,
    });

    this.sendToUser(result.receiverId, {
      type: 'sandbox_message',
      mode: 'sandbox',
      match_id: result.matchId,
      message_id: result.messageId,
      sender_id: result.senderId,
      text: result.rewrittenText,
      ai_action: result.aiAction,
      resonance_score: result.resonanceScore,
      created_at: result.createdAt,
    });

    this.sendToUser(result.senderId, {
      type: 'resonance_update',
      match_id: result.matchId,
      resonance_score: result.resonanceScore,
    });
    this.sendToUser(result.receiverId, {
      type: 'resonance_update',
      match_id: result.matchId,
      resonance_score: result.resonanceScore,
    });

    if (result.wallReady) {
      const payload = {
        type: 'wall_ready',
        match_id: result.matchId,
        prompt: '你们已达到破壁条件，是否进入直聊？',
        resonance_score: result.resonanceScore,
      };
      this.sendToUser(result.senderId, payload);
      this.sendToUser(result.receiverId, payload);
    }
  }

  private async handleDirectMessage(clientId: string, event: DirectMessageEvent) {
    const state = this.connections.get(clientId);
    if (!state?.userId) {
      this.send(clientId, { type: 'error', message: '请先完成登录鉴权。' });
      return;
    }

    const matchId = event.match_id?.trim() || state.matchId || '';
    const text = event.text?.trim() || '';
    if (!matchId) {
      this.send(clientId, { type: 'error', message: '缺少会话 ID。' });
      return;
    }
    if (!text) {
      this.send(clientId, { type: 'error', message: '消息内容不能为空。' });
      return;
    }

    const result = await this.sandboxService.processDirectMessage({
      matchId,
      senderId: state.userId,
      text,
    });

    this.send(clientId, {
      type: 'message_delivered',
      mode: 'direct',
      match_id: result.matchId,
      message_id: result.messageId,
      sender_id: result.senderId,
      receiver_id: result.receiverId,
      text: result.text,
      created_at: result.createdAt,
    });

    this.sendToUser(result.receiverId, {
      type: 'direct_message',
      mode: 'direct',
      match_id: result.matchId,
      message_id: result.messageId,
      sender_id: result.senderId,
      text: result.text,
      created_at: result.createdAt,
    });
  }

  private send(clientId: string, payload: unknown) {
    if (!this.socketServer) {
      return;
    }
    this.socketServer.sendJson(clientId, payload);
  }

  private sendToUser(userId: string, payload: unknown) {
    if (!this.socketServer) {
      return;
    }
    const ids = this.userConnections.get(userId);
    if (!ids || ids.size === 0) {
      return;
    }
    this.socketServer.broadcastJson(ids, payload);
  }

  private addUserConnection(userId: string, clientId: string) {
    const set = this.userConnections.get(userId) || new Set<string>();
    set.add(clientId);
    this.userConnections.set(userId, set);
  }

  private removeUserConnection(userId: string, clientId: string) {
    const set = this.userConnections.get(userId);
    if (!set) {
      return;
    }
    set.delete(clientId);
    if (set.size === 0) {
      this.userConnections.delete(userId);
    }
  }

  private removeConnection(clientId: string) {
    const state = this.connections.get(clientId);
    if (!state) {
      return;
    }

    // Notify counterpart that this user went offline
    if (state.userId && state.matchId) {
      this.notifyPeerOffline(state.userId, state.matchId);
    }

    if (state.userId) {
      this.removeUserConnection(state.userId, clientId);
    }
    this.connections.delete(clientId);
    this.logger.debug(`WebSocket disconnected: ${clientId}`);
  }

  private isUserOnline(userId: string): boolean {
    const set = this.userConnections.get(userId);
    return !!set && set.size > 0;
  }

  private notifyPeerOffline(disconnectedUserId: string, matchId: string) {
    // Find counterpart: look through all connections for someone in the same match
    for (const [, connState] of this.connections) {
      if (
        connState.matchId === matchId &&
        connState.userId &&
        connState.userId !== disconnectedUserId
      ) {
        this.sendToUser(connState.userId, {
          type: 'peer_offline',
          match_id: matchId,
          user_id: disconnectedUserId,
        });
        break;
      }
    }
  }
}
