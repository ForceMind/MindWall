import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { getAppVersion } from '../../foundation/app-version';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health() {
    let db = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }

    return {
      status: db === 'up' ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      version: getAppVersion(),
      services: {
        api: 'up',
        db,
      },
      env: process.env.NODE_ENV || 'development',
    };
  }
}
