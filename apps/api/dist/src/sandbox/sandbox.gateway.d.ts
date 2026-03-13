import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { SandboxService } from './sandbox.service';
export declare class SandboxGatewayService implements OnModuleInit, OnModuleDestroy {
    private readonly httpAdapterHost;
    private readonly sandboxService;
    private readonly logger;
    private readonly connections;
    private readonly userConnections;
    private socketServer;
    constructor(httpAdapterHost: HttpAdapterHost, sandboxService: SandboxService);
    onModuleInit(): void;
    onModuleDestroy(): void;
    private handleInboundEvent;
    private handleAuth;
    private handleJoinMatch;
    private handleFetchHistory;
    private handleWallState;
    private handleWallBreakDecision;
    private handleSandboxMessage;
    private handleDirectMessage;
    private send;
    private sendToUser;
    private addUserConnection;
    private removeUserConnection;
    private removeConnection;
}
