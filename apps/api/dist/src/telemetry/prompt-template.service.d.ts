import { OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
export declare class PromptTemplateService implements OnModuleInit {
    private readonly prisma;
    private readonly defaults;
    constructor(prisma: PrismaService);
    onModuleInit(): Promise<void>;
    getPrompt(key: string, fallback: string): Promise<string>;
    listPrompts(): Promise<{
        id: string;
        name: string;
        key: string;
        category: string;
        content: string;
        version: number;
        is_active: boolean;
        updated_at: Date;
    }[]>;
    upsertPrompt(key: string, body: {
        name?: string;
        category?: string;
        content?: string;
        is_active?: boolean;
    }): Promise<{
        id: string;
        created_at: Date;
        name: string;
        key: string;
        category: string;
        content: string;
        version: number;
        is_active: boolean;
        updated_at: Date;
    }>;
}
