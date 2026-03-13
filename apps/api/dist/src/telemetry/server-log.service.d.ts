export declare class ServerLogService {
    private readonly logger;
    private readonly logDir;
    private readonly logFile;
    info(event: string, message: string, metadata?: Record<string, unknown>): Promise<void>;
    warn(event: string, message: string, metadata?: Record<string, unknown>): Promise<void>;
    error(event: string, message: string, metadata?: Record<string, unknown>): Promise<void>;
    tail(lines?: number): Promise<{
        file: string;
        lines: string[];
        count: number;
    }>;
    private append;
    private ensureFile;
}
