import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
export declare class PromptTemplateService implements OnModuleInit {
    private readonly prisma;
    private readonly defaults;
    constructor(prisma: PrismaService);
    onModuleInit(): Promise<void>;
    getPrompt(key: string, fallback: string): Promise<string>;
    listPrompts(): Promise<{
        updated_at: Date;
        id: string;
        name: string;
        key: string;
        category: string;
        content: string;
        version: number;
        is_active: boolean;
    }[]>;
    upsertPrompt(key: string, body: {
        name?: string;
        category?: string;
        content?: string;
        is_active?: boolean;
    }): Promise<{
        created_at: Date;
        updated_at: Date;
        id: string;
        name: string;
        key: string;
        category: string;
        content: string;
        version: number;
        is_active: boolean;
    }>;
}
