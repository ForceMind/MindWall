import { Server } from 'http';
type ConnectHandler = (clientId: string) => void;
type CloseHandler = (clientId: string) => void;
type MessageHandler = (clientId: string, payload: unknown) => Promise<void> | void;
interface WebSocketServerHandlers {
    onConnect?: ConnectHandler;
    onClose?: CloseHandler;
    onMessage?: MessageHandler;
}
export declare class NativeWebSocketServer {
    private readonly path;
    private readonly handlers;
    private readonly clients;
    private readonly buffers;
    private server;
    constructor(path: string, handlers: WebSocketServerHandlers);
    attach(server: Server): void;
    close(): void;
    sendJson(clientId: string, payload: unknown): boolean;
    broadcastJson(clientIds: Iterable<string>, payload: unknown): void;
    private readonly handleUpgrade;
    private processIncomingChunk;
    private tryParseFrame;
    private encodeTextFrame;
    private encodeControlFrame;
    private encodeFrame;
    private closeClient;
    private cleanupClient;
}
export {};
