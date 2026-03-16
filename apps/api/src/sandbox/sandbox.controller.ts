import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SessionUser } from '../auth/auth.types';
import { SandboxService } from './sandbox.service';

@Controller('sandbox')
export class SandboxController {
  constructor(private readonly sandboxService: SandboxService) {}

  @Get('me/matches/:matchId/messages')
  @UseGuards(SessionAuthGuard)
  async getMyMatchMessages(
    @CurrentUser() user: SessionUser,
    @Param('matchId') matchId: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit);
    const normalizedLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.round(parsedLimit)
        : 50;

    return this.sandboxService.getMatchMessages(
      matchId,
      user.userId,
      normalizedLimit,
    );
  }

  @Get('me/matches/:matchId/wall-state')
  @UseGuards(SessionAuthGuard)
  async getMyWallState(
    @CurrentUser() user: SessionUser,
    @Param('matchId') matchId: string,
  ) {
    return this.sandboxService.getWallState(matchId, user.userId);
  }

  @Post('me/matches/:matchId/wall-decision')
  @UseGuards(SessionAuthGuard)
  async submitMyWallDecision(
    @CurrentUser() user: SessionUser,
    @Param('matchId') matchId: string,
    @Body() body: { accept?: boolean },
  ) {
    return this.sandboxService.submitWallDecision({
      matchId,
      userId: user.userId,
      accept: body.accept === true,
    });
  }
}
