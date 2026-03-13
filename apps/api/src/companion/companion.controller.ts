import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SessionUser } from '../auth/auth.types';
import { CompanionService } from './companion.service';

@Controller('companion')
@UseGuards(SessionAuthGuard)
export class CompanionController {
  constructor(private readonly companionService: CompanionService) {}

  @Post('respond')
  async respond(
    @CurrentUser() user: SessionUser,
    @Body()
    body: {
      companion_id?: string;
      history?: Array<{ role?: string; text?: string }>;
    },
  ) {
    return this.companionService.respond(user.userId, body);
  }
}
