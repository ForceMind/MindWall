import { AdminConfigService } from '../admin/admin-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiUsageService } from '../telemetry/ai-usage.service';
import { PromptTemplateService } from '../telemetry/prompt-template.service';
import { ServerLogService } from '../telemetry/server-log.service';
interface CompanionTurnInput {
    role?: string;
    text?: string;
}
interface CompanionRequestBody {
    history?: CompanionTurnInput[];
    companion_id?: string;
}
export declare class CompanionService {
    private readonly prisma;
    private readonly adminConfigService;
    private readonly promptTemplateService;
    private readonly aiUsageService;
    private readonly serverLogService;
    private readonly logger;
    private readonly personas;
    constructor(prisma: PrismaService, adminConfigService: AdminConfigService, promptTemplateService: PromptTemplateService, aiUsageService: AiUsageService, serverLogService: ServerLogService);
    respond(userId: string, body: CompanionRequestBody): Promise<{
        mode: string;
        contact_id: string;
        contact_name: string;
        reply: string;
    }>;
    private normalizeHistory;
    private resolvePersona;
    private buildFallbackReply;
    private callOpenAi;
}
export {};
