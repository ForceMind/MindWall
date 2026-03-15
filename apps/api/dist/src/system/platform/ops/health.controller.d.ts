import { PrismaService } from '../../../prisma/prisma.service';
export declare class HealthController {
    private readonly prisma;
    constructor(prisma: PrismaService);
    health(): Promise<{
        status: string;
        time: string;
        services: {
            api: string;
            db: string;
        };
        env: string;
    }>;
}
