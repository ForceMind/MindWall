"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SandboxGatewayService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SandboxGatewayService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const native_websocket_server_1 = require("./native-websocket.server");
const sandbox_service_1 = require("./sandbox.service");
let SandboxGatewayService = SandboxGatewayService_1 = class SandboxGatewayService {
    httpAdapterHost;
    sandboxService;
    logger = new common_1.Logger(SandboxGatewayService_1.name);
    connections = new Map();
    userConnections = new Map();
    socketServer = null;
    constructor(httpAdapterHost, sandboxService) {
        this.httpAdapterHost = httpAdapterHost;
        this.sandboxService = sandboxService;
    }
    onModuleInit() {
        const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
        this.socketServer = new native_websocket_server_1.NativeWebSocketServer('/ws/sandbox', {
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
    async handleInboundEvent(clientId, payload) {
        const event = payload;
        if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
            this.send(clientId, { type: 'error', message: 'Unknown event payload.' });
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
        this.send(clientId, { type: 'error', message: 'Unsupported event type.' });
    }
    async handleAuth(clientId, event) {
        const userId = event.user_id?.trim();
        if (!userId) {
            this.send(clientId, { type: 'error', message: 'user_id is required for auth.' });
            return;
        }
        const exists = await this.sandboxService.ensureUserExists(userId);
        if (!exists) {
            this.send(clientId, { type: 'error', message: 'User not found.' });
            return;
        }
        const state = this.connections.get(clientId);
        if (!state) {
            this.send(clientId, { type: 'error', message: 'Connection not found.' });
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
    async handleJoinMatch(clientId, event) {
        const state = this.connections.get(clientId);
        if (!state?.userId) {
            this.send(clientId, { type: 'error', message: 'Authenticate first.' });
            return;
        }
        const matchId = event.match_id?.trim();
        if (!matchId) {
            this.send(clientId, { type: 'error', message: 'match_id is required.' });
            return;
        }
        const info = await this.sandboxService.assertMatchParticipant(matchId, state.userId);
        const wallState = await this.sandboxService.getWallState(matchId, state.userId);
        state.matchId = matchId;
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
    }
    async handleFetchHistory(clientId, event) {
        const state = this.connections.get(clientId);
        if (!state?.userId) {
            this.send(clientId, { type: 'error', message: 'Authenticate first.' });
            return;
        }
        const matchId = event.match_id?.trim() || state.matchId || '';
        if (!matchId) {
            this.send(clientId, { type: 'error', message: 'match_id is required.' });
            return;
        }
        const limit = typeof event.limit === 'number' && Number.isFinite(event.limit)
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
    async handleWallState(clientId, event) {
        const state = this.connections.get(clientId);
        if (!state?.userId) {
            this.send(clientId, { type: 'error', message: 'Authenticate first.' });
            return;
        }
        const matchId = event.match_id?.trim() || state.matchId || '';
        if (!matchId) {
            this.send(clientId, { type: 'error', message: 'match_id is required.' });
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
    async handleWallBreakDecision(clientId, event) {
        const state = this.connections.get(clientId);
        if (!state?.userId) {
            this.send(clientId, { type: 'error', message: 'Authenticate first.' });
            return;
        }
        const matchId = event.match_id?.trim() || state.matchId || '';
        if (!matchId) {
            this.send(clientId, { type: 'error', message: 'match_id is required.' });
            return;
        }
        const accept = event.accept === true;
        const requesterState = await this.sandboxService.submitWallDecision({
            matchId,
            userId: state.userId,
            accept,
        });
        const counterpartUserId = requesterState.counterpartProfile.userId;
        const counterpartState = await this.sandboxService.getWallState(requesterState.matchId, counterpartUserId);
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
    async handleSandboxMessage(clientId, event) {
        const state = this.connections.get(clientId);
        if (!state?.userId) {
            this.send(clientId, { type: 'error', message: 'Authenticate first.' });
            return;
        }
        const matchId = event.match_id?.trim() || state.matchId || '';
        const text = event.text?.trim() || '';
        if (!matchId) {
            this.send(clientId, { type: 'error', message: 'match_id is required.' });
            return;
        }
        if (!text) {
            this.send(clientId, { type: 'error', message: 'text is required.' });
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
                prompt: 'Ready to break the wall?',
                resonance_score: result.resonanceScore,
            };
            this.sendToUser(result.senderId, payload);
            this.sendToUser(result.receiverId, payload);
        }
    }
    async handleDirectMessage(clientId, event) {
        const state = this.connections.get(clientId);
        if (!state?.userId) {
            this.send(clientId, { type: 'error', message: 'Authenticate first.' });
            return;
        }
        const matchId = event.match_id?.trim() || state.matchId || '';
        const text = event.text?.trim() || '';
        if (!matchId) {
            this.send(clientId, { type: 'error', message: 'match_id is required.' });
            return;
        }
        if (!text) {
            this.send(clientId, { type: 'error', message: 'text is required.' });
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
    send(clientId, payload) {
        if (!this.socketServer) {
            return;
        }
        this.socketServer.sendJson(clientId, payload);
    }
    sendToUser(userId, payload) {
        if (!this.socketServer) {
            return;
        }
        const ids = this.userConnections.get(userId);
        if (!ids || ids.size === 0) {
            return;
        }
        this.socketServer.broadcastJson(ids, payload);
    }
    addUserConnection(userId, clientId) {
        const set = this.userConnections.get(userId) || new Set();
        set.add(clientId);
        this.userConnections.set(userId, set);
    }
    removeUserConnection(userId, clientId) {
        const set = this.userConnections.get(userId);
        if (!set) {
            return;
        }
        set.delete(clientId);
        if (set.size === 0) {
            this.userConnections.delete(userId);
        }
    }
    removeConnection(clientId) {
        const state = this.connections.get(clientId);
        if (!state) {
            return;
        }
        if (state.userId) {
            this.removeUserConnection(state.userId, clientId);
        }
        this.connections.delete(clientId);
        this.logger.debug(`WebSocket disconnected: ${clientId}`);
    }
};
exports.SandboxGatewayService = SandboxGatewayService;
exports.SandboxGatewayService = SandboxGatewayService = SandboxGatewayService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.HttpAdapterHost,
        sandbox_service_1.SandboxService])
], SandboxGatewayService);
//# sourceMappingURL=sandbox.gateway.js.map