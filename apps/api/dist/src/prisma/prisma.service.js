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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaService = void 0;
require("dotenv/config");
const common_1 = require("@nestjs/common");
const adapter_pg_1 = require("@prisma/adapter-pg");
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
let PrismaService = class PrismaService extends client_1.PrismaClient {
    pool;
    constructor() {
        const databaseUrl = process.env.DATABASE_URL?.trim();
        if (!databaseUrl) {
            throw new common_1.InternalServerErrorException('DATABASE_URL is not configured for Prisma runtime.');
        }
        const pool = new pg_1.Pool({
            connectionString: databaseUrl,
        });
        super({
            adapter: new adapter_pg_1.PrismaPg(pool),
        });
        this.pool = pool;
    }
    async onModuleInit() {
        try {
            await this.$connect();
            await this.$queryRawUnsafe('SELECT 1');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new common_1.InternalServerErrorException(`PostgreSQL is unavailable during startup. Verify DATABASE_URL and start the database before launching the API. ${message}`);
        }
    }
    async onModuleDestroy() {
        await this.$disconnect();
        await this.pool.end();
    }
};
exports.PrismaService = PrismaService;
exports.PrismaService = PrismaService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], PrismaService);
//# sourceMappingURL=prisma.service.js.map