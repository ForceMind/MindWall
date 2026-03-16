import { createHash, randomUUID } from 'crypto';
import { IncomingMessage, Server } from 'http';
import { Socket } from 'net';

type ConnectHandler = (clientId: string) => void;
type CloseHandler = (clientId: string) => void;
type MessageHandler = (clientId: string, payload: unknown) => Promise<void> | void;

interface WebSocketServerHandlers {
  onConnect?: ConnectHandler;
  onClose?: CloseHandler;
  onMessage?: MessageHandler;
}

interface ParsedFrame {
  consumed: number;
  opcode: number;
  payload: Buffer;
}

export class NativeWebSocketServer {
  private readonly clients = new Map<string, Socket>();
  private readonly buffers = new Map<string, Buffer>();
  private server: Server | null = null;

  constructor(
    private readonly path: string,
    private readonly handlers: WebSocketServerHandlers,
  ) {}

  attach(server: Server) {
    if (this.server) {
      return;
    }
    this.server = server;
    this.server.on('upgrade', this.handleUpgrade);
  }

  close() {
    if (this.server) {
      this.server.off('upgrade', this.handleUpgrade);
      this.server = null;
    }
    for (const clientId of this.clients.keys()) {
      this.closeClient(clientId);
    }
  }

  sendJson(clientId: string, payload: unknown) {
    const socket = this.clients.get(clientId);
    if (!socket || socket.destroyed) {
      return false;
    }
    const message = JSON.stringify(payload);
    socket.write(this.encodeTextFrame(message));
    return true;
  }

  broadcastJson(clientIds: Iterable<string>, payload: unknown) {
    for (const clientId of clientIds) {
      this.sendJson(clientId, payload);
    }
  }

  private readonly handleUpgrade = (
    req: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ) => {
    const requestUrl = req.url || '/';
    const host = req.headers.host || 'localhost';
    const parsed = new URL(requestUrl, `http://${host}`);
    if (parsed.pathname !== this.path) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const upgrade = req.headers.upgrade;
    const key = req.headers['sec-websocket-key'];
    if (
      !upgrade ||
      upgrade.toLowerCase() !== 'websocket' ||
      typeof key !== 'string'
    ) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');

    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n'),
    );

    const clientId = randomUUID();
    this.clients.set(clientId, socket);
    this.buffers.set(clientId, Buffer.alloc(0));

    if (head.length > 0) {
      this.processIncomingChunk(clientId, head);
    }

    socket.on('data', (chunk: Buffer) => {
      this.processIncomingChunk(clientId, chunk);
    });
    socket.on('close', () => {
      this.cleanupClient(clientId);
    });
    socket.on('error', () => {
      this.cleanupClient(clientId);
    });

    this.handlers.onConnect?.(clientId);
  };

  private processIncomingChunk(clientId: string, chunk: Buffer) {
    const socket = this.clients.get(clientId);
    if (!socket || socket.destroyed) {
      return;
    }

    const previous = this.buffers.get(clientId) || Buffer.alloc(0);
    let buffer = Buffer.concat([previous, chunk]);

    while (true) {
      const frame = this.tryParseFrame(buffer);
      if (!frame) {
        break;
      }
      buffer = buffer.subarray(frame.consumed);

      if (frame.opcode === 0x8) {
        this.closeClient(clientId);
        return;
      }

      if (frame.opcode === 0x9) {
        socket.write(this.encodeControlFrame(0x0a, frame.payload));
        continue;
      }

      if (frame.opcode !== 0x1) {
        continue;
      }

      const text = frame.payload.toString('utf8');
      let payload: unknown = null;
      try {
        payload = JSON.parse(text);
      } catch {
        this.sendJson(clientId, {
          type: 'error',
          message: '消息解析失败，请检查消息格式。',
        });
        continue;
      }

      Promise.resolve(this.handlers.onMessage?.(clientId, payload)).catch(
        (error: unknown) => {
          const message =
            error instanceof Error ? error.message : '消息处理失败，请稍后重试。';
          this.sendJson(clientId, { type: 'error', message });
        },
      );
    }

    this.buffers.set(clientId, buffer);
  }

  private tryParseFrame(buffer: Buffer): ParsedFrame | null {
    if (buffer.length < 2) {
      return null;
    }

    const first = buffer[0];
    const second = buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) === 0x80;
    let payloadLength = second & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (buffer.length < offset + 2) {
        return null;
      }
      payloadLength = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (buffer.length < offset + 8) {
        return null;
      }
      const high = buffer.readUInt32BE(offset);
      const low = buffer.readUInt32BE(offset + 4);
      const maxSafe = Number.MAX_SAFE_INTEGER;
      const combined = high * 2 ** 32 + low;
      payloadLength = combined > maxSafe ? maxSafe : combined;
      offset += 8;
    }

    const maskLength = masked ? 4 : 0;
    const fullLength = offset + maskLength + payloadLength;
    if (buffer.length < fullLength) {
      return null;
    }

    let payload = buffer.subarray(offset + maskLength, fullLength);
    if (masked) {
      const mask = buffer.subarray(offset, offset + 4);
      const decoded = Buffer.allocUnsafe(payloadLength);
      for (let index = 0; index < payloadLength; index += 1) {
        decoded[index] = payload[index] ^ mask[index % 4];
      }
      payload = decoded;
    }

    return {
      consumed: fullLength,
      opcode,
      payload,
    };
  }

  private encodeTextFrame(text: string) {
    const payload = Buffer.from(text);
    return this.encodeFrame(0x1, payload);
  }

  private encodeControlFrame(opcode: number, payload: Buffer) {
    return this.encodeFrame(opcode, payload);
  }

  private encodeFrame(opcode: number, payload: Buffer) {
    const payloadLength = payload.length;
    if (payloadLength < 126) {
      const header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = payloadLength;
      return Buffer.concat([header, payload]);
    }
    if (payloadLength < 65536) {
      const header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(payloadLength, 2);
      return Buffer.concat([header, payload]);
    }
    const header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(Math.floor(payloadLength / 2 ** 32), 2);
    header.writeUInt32BE(payloadLength >>> 0, 6);
    return Buffer.concat([header, payload]);
  }

  private closeClient(clientId: string) {
    const socket = this.clients.get(clientId);
    if (socket && !socket.destroyed) {
      socket.end(this.encodeControlFrame(0x8, Buffer.alloc(0)));
      socket.destroy();
    }
    this.cleanupClient(clientId);
  }

  private cleanupClient(clientId: string) {
    if (!this.clients.has(clientId)) {
      return;
    }
    this.clients.delete(clientId);
    this.buffers.delete(clientId);
    this.handlers.onClose?.(clientId);
  }
}
