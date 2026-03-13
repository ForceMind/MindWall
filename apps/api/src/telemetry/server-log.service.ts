import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';

@Injectable()
export class ServerLogService {
  private readonly logger = new Logger(ServerLogService.name);
  private readonly logDir = path.join(process.cwd(), 'logs');
  private readonly logFile = path.join(this.logDir, 'server.log');

  async info(event: string, message: string, metadata?: Record<string, unknown>) {
    await this.append('INFO', event, message, metadata);
  }

  async warn(event: string, message: string, metadata?: Record<string, unknown>) {
    await this.append('WARN', event, message, metadata);
  }

  async error(event: string, message: string, metadata?: Record<string, unknown>) {
    await this.append('ERROR', event, message, metadata);
  }

  async tail(lines = 200) {
    const safeLines = Math.max(1, Math.min(2000, Math.round(lines || 200)));
    await this.ensureFile();
    const text = await fs.readFile(this.logFile, 'utf8');
    const rows = text
      .split(/\r?\n/)
      .filter((item) => item.trim().length > 0)
      .slice(-safeLines);
    return {
      file: this.logFile,
      lines: rows,
      count: rows.length,
    };
  }

  private async append(
    level: 'INFO' | 'WARN' | 'ERROR',
    event: string,
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    try {
      await this.ensureFile();
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        event,
        message,
        metadata: metadata || null,
      });
      await fs.appendFile(this.logFile, `${line}\n`, 'utf8');
    } catch (error) {
      this.logger.warn(`append log failed: ${(error as Error).message}`);
    }
  }

  private async ensureFile() {
    await fs.mkdir(this.logDir, { recursive: true });
    try {
      await fs.access(this.logFile);
    } catch {
      await fs.writeFile(this.logFile, '', 'utf8');
    }
  }
}
