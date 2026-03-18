import { Body, Controller, Get, Param, Post, UseGuards, ForbiddenException } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SessionUser } from '../auth/auth.types';
import { CompanionService } from './companion.service';

@Controller('companion')
@UseGuards(SessionAuthGuard)
export class CompanionController {
  constructor(private readonly companionService: CompanionService) {}

  @Get('sessions/:sessionId/messages')
  async getMessages(
    @CurrentUser() user: SessionUser,
    @Param('sessionId') sessionId: string,
  ) {
    return this.companionService.getMessages(user.userId, sessionId);
  }

  @Post('respond')
  async respond(
    @CurrentUser() user: SessionUser,
    @Body()
    body: {
      companion_id?: string;
      session_id?: string;
      history?: Array<{ role?: string; text?: string }>;
    },
  ) {
    return this.companionService.respond(user.userId, body);
  }
}
