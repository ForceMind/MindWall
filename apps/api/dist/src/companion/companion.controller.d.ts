import type { SessionUser } from '../auth/auth.types';
import { CompanionService } from './companion.service';
export declare class CompanionController {
    private readonly companionService;
    constructor(companionService: CompanionService);
    respond(user: SessionUser, body: {
        companion_id?: string;
        history?: Array<{
            role?: string;
            text?: string;
        }>;
    }): Promise<{
        mode: string;
        contact_id: string;
        contact_name: string;
        reply: string;
    }>;
}
