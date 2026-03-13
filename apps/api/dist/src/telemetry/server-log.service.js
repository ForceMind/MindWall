"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var ServerLogService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerLogService = void 0;
const common_1 = require("@nestjs/common");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
let ServerLogService = ServerLogService_1 = class ServerLogService {
    logger = new common_1.Logger(ServerLogService_1.name);
    logDir = path_1.default.join(process.cwd(), 'logs');
    logFile = path_1.default.join(this.logDir, 'server.log');
    async info(event, message, metadata) {
        await this.append('INFO', event, message, metadata);
    }
    async warn(event, message, metadata) {
        await this.append('WARN', event, message, metadata);
    }
    async error(event, message, metadata) {
        await this.append('ERROR', event, message, metadata);
    }
    async tail(lines = 200) {
        const safeLines = Math.max(1, Math.min(2000, Math.round(lines || 200)));
        await this.ensureFile();
        const text = await fs_1.promises.readFile(this.logFile, 'utf8');
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
    async append(level, event, message, metadata) {
        try {
            await this.ensureFile();
            const line = JSON.stringify({
                ts: new Date().toISOString(),
                level,
                event,
                message,
                metadata: metadata || null,
            });
            await fs_1.promises.appendFile(this.logFile, `${line}\n`, 'utf8');
        }
        catch (error) {
            this.logger.warn(`append log failed: ${error.message}`);
        }
    }
    async ensureFile() {
        await fs_1.promises.mkdir(this.logDir, { recursive: true });
        try {
            await fs_1.promises.access(this.logFile);
        }
        catch {
            await fs_1.promises.writeFile(this.logFile, '', 'utf8');
        }
    }
};
exports.ServerLogService = ServerLogService;
exports.ServerLogService = ServerLogService = ServerLogService_1 = __decorate([
    (0, common_1.Injectable)()
], ServerLogService);
//# sourceMappingURL=server-log.service.js.map