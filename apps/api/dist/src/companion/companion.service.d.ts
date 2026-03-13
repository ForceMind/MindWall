import { AdminConfigService } from '../admin/admin-config.service';
import { PrismaService } from '../prisma/prisma.service';
interface CompanionTurnInput {
    role?: string;
    text?: string;
}
interface CompanionRequestBody {
    history?: CompanionTurnInput[];
}
export declare class CompanionService {
    private readonly prisma;
    private readonly adminConfigService;
    private readonly logger;
    constructor(prisma: PrismaService, adminConfigService: AdminConfigService);
    respond(userId: string, body: CompanionRequestBody): Promise<{
        mode: string;
        disclosed: boolean;
        reply: string;
    }>;
    private normalizeHistory;
    private buildFallbackReply;
    private callOpenAi;
}
export {};
