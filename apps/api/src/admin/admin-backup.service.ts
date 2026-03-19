import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import { PrismaService } from '../prisma/prisma.service';

interface BackupData {
  _mindwall_backup: true;
  version: string;
  exported_at: string;
  tables: Record<string, any[]>;
  runtime_config?: Record<string, unknown>;
}

@Injectable()
export class AdminBackupService {
  private readonly logger = new Logger(AdminBackupService.name);
  private readonly configFile = path.join(process.cwd(), 'config', 'runtime-config.json');

  constructor(private readonly prisma: PrismaService) {}

  async getBackupInfo() {
    const [
      userCount,
      profileCount,
      tagCount,
      matchCount,
      sandboxMsgCount,
      companionSessionCount,
      companionMsgCount,
      interviewRecordCount,
      aiLogCount,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.userProfile.count(),
      this.prisma.userTag.count(),
      this.prisma.match.count(),
      this.prisma.sandboxMessage.count(),
      this.prisma.companionSession.count(),
      this.prisma.companionMessage.count(),
      this.prisma.onboardingInterviewRecord.count(),
      this.prisma.aiGenerationLog.count(),
    ]);
    return {
      users: userCount,
      profiles: profileCount,
      tags: tagCount,
      matches: matchCount,
      sandbox_messages: sandboxMsgCount,
      companion_sessions: companionSessionCount,
      companion_messages: companionMsgCount,
      interview_records: interviewRecordCount,
      ai_logs: aiLogCount,
    };
  }

  async exportBackup(): Promise<BackupData> {
    const [
      users,
      credentials,
      authSessions,
      profiles,
      tags,
      matches,
      sandboxMessages,
      companionSessions,
      companionMessages,
      interviewRecords,
      interviewSessions,
      aiLogs,
      promptTemplates,
    ] = await Promise.all([
      this.prisma.user.findMany(),
      this.prisma.userCredential.findMany(),
      this.prisma.authSession.findMany(),
      this.prisma.userProfile.findMany(),
      this.prisma.userTag.findMany(),
      this.prisma.match.findMany(),
      this.prisma.sandboxMessage.findMany(),
      this.prisma.companionSession.findMany(),
      this.prisma.companionMessage.findMany(),
      this.prisma.onboardingInterviewRecord.findMany(),
      this.prisma.onboardingInterviewSession.findMany(),
      this.prisma.aiGenerationLog.findMany(),
      this.prisma.promptTemplate.findMany(),
    ]);

    let runtimeConfig: Record<string, unknown> | undefined;
    try {
      const raw = await fs.readFile(this.configFile, 'utf-8');
      runtimeConfig = JSON.parse(raw);
    } catch {
      runtimeConfig = undefined;
    }

    return {
      _mindwall_backup: true,
      version: '1.0',
      exported_at: new Date().toISOString(),
      tables: {
        users,
        user_credentials: credentials,
        auth_sessions: authSessions,
        user_profiles: profiles,
        user_tags: tags,
        matches,
        sandbox_messages: sandboxMessages,
        companion_sessions: companionSessions,
        companion_messages: companionMessages,
        onboarding_interview_records: interviewRecords,
        onboarding_interview_sessions: interviewSessions,
        ai_generation_logs: aiLogs,
        prompt_templates: promptTemplates,
      },
      runtime_config: runtimeConfig,
    };
  }

  async importBackup(data: BackupData) {
    const tables = data.tables;
    const counts: Record<string, number> = {};

    // Delete all data in reverse dependency order
    await this.clearAllTables();

    // Insert in dependency order
    if (tables.users?.length) {
      for (const row of tables.users) {
        await this.prisma.user.create({ data: this.cleanRow(row) });
      }
      counts.users = tables.users.length;
    }

    if (tables.user_credentials?.length) {
      for (const row of tables.user_credentials) {
        await this.prisma.userCredential.create({ data: this.cleanRow(row) });
      }
      counts.user_credentials = tables.user_credentials.length;
    }

    if (tables.auth_sessions?.length) {
      for (const row of tables.auth_sessions) {
        await this.prisma.authSession.create({ data: this.cleanRow(row) });
      }
      counts.auth_sessions = tables.auth_sessions.length;
    }

    if (tables.user_profiles?.length) {
      for (const row of tables.user_profiles) {
        await this.prisma.userProfile.create({ data: this.cleanRow(row) });
      }
      counts.user_profiles = tables.user_profiles.length;
    }

    if (tables.user_tags?.length) {
      for (const row of tables.user_tags) {
        await this.prisma.userTag.create({ data: this.cleanRow(row) });
      }
      counts.user_tags = tables.user_tags.length;
    }

    if (tables.matches?.length) {
      for (const row of tables.matches) {
        await this.prisma.match.create({ data: this.cleanRow(row) });
      }
      counts.matches = tables.matches.length;
    }

    if (tables.sandbox_messages?.length) {
      for (const row of tables.sandbox_messages) {
        await this.prisma.sandboxMessage.create({ data: this.cleanRow(row) });
      }
      counts.sandbox_messages = tables.sandbox_messages.length;
    }

    if (tables.companion_sessions?.length) {
      for (const row of tables.companion_sessions) {
        await this.prisma.companionSession.create({ data: this.cleanRow(row) });
      }
      counts.companion_sessions = tables.companion_sessions.length;
    }

    if (tables.companion_messages?.length) {
      for (const row of tables.companion_messages) {
        await this.prisma.companionMessage.create({ data: this.cleanRow(row) });
      }
      counts.companion_messages = tables.companion_messages.length;
    }

    if (tables.onboarding_interview_records?.length) {
      for (const row of tables.onboarding_interview_records) {
        await this.prisma.onboardingInterviewRecord.create({ data: this.cleanRow(row) });
      }
      counts.onboarding_interview_records = tables.onboarding_interview_records.length;
    }

    if (tables.onboarding_interview_sessions?.length) {
      for (const row of tables.onboarding_interview_sessions) {
        await this.prisma.onboardingInterviewSession.create({ data: this.cleanRow(row) });
      }
      counts.onboarding_interview_sessions = tables.onboarding_interview_sessions.length;
    }

    if (tables.ai_generation_logs?.length) {
      for (const row of tables.ai_generation_logs) {
        await this.prisma.aiGenerationLog.create({ data: this.cleanRow(row) });
      }
      counts.ai_generation_logs = tables.ai_generation_logs.length;
    }

    if (tables.prompt_templates?.length) {
      for (const row of tables.prompt_templates) {
        await this.prisma.promptTemplate.upsert({
          where: { key: row.key },
          create: this.cleanRow(row),
          update: this.cleanRow(row),
        });
      }
      counts.prompt_templates = tables.prompt_templates.length;
    }

    // Restore runtime config if present
    if (data.runtime_config) {
      try {
        const configDir = path.dirname(this.configFile);
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(this.configFile, JSON.stringify(data.runtime_config, null, 2), 'utf-8');
        counts.runtime_config = 1;
      } catch (err) {
        this.logger.warn(`Failed to restore runtime config: ${(err as Error).message}`);
      }
    }

    return { status: 'ok', restored: counts };
  }

  async resetAllData() {
    await this.clearAllTables();
    return { status: 'ok', message: 'All user data has been cleared' };
  }

  private async clearAllTables() {
    // Delete in reverse dependency order using raw SQL for speed
    await this.prisma.$executeRawUnsafe('DELETE FROM "companion_messages"');
    await this.prisma.$executeRawUnsafe('DELETE FROM "companion_sessions"');
    await this.prisma.$executeRawUnsafe('DELETE FROM "sandbox_messages"');
    await this.prisma.$executeRawUnsafe('DELETE FROM "onboarding_interview_records"');
    await this.prisma.$executeRawUnsafe('DELETE FROM "onboarding_interview_sessions"');
    await this.prisma.$executeRawUnsafe('DELETE FROM "ai_generation_logs"');
    await this.prisma.$executeRawUnsafe('DELETE FROM "user_tags"');
    await this.prisma.$executeRawUnsafe('DELETE FROM "matches"');
    await this.prisma.$executeRawUnsafe('DELETE FROM "user_profiles"');
    await this.prisma.$executeRawUnsafe('DELETE FROM "auth_sessions"');
    await this.prisma.$executeRawUnsafe('DELETE FROM "user_credentials"');
    await this.prisma.$executeRawUnsafe('DELETE FROM "users"');
  }

  private cleanRow(row: any): any {
    const cleaned = { ...row };
    // Remove Prisma relation fields that shouldn't be in create data
    delete cleaned.user;
    delete cleaned.sender;
    delete cleaned.receiver;
    delete cleaned.user_a;
    delete cleaned.user_b;
    delete cleaned.session;
    delete cleaned.messages;
    delete cleaned.credential;
    delete cleaned.profile;
    delete cleaned.tags;
    delete cleaned.matches_as_a;
    delete cleaned.matches_as_b;
    return cleaned;
  }
}
