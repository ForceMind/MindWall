import {
  BadRequestException,
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

  @Get('matches/:matchId/messages')
  async getMatchMessages(
    @Param('matchId') matchId: string,
    @Query('user_id') userId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit);
    const normalizedLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.round(parsedLimit)
        : 50;

    return this.sandboxService.getMatchMessages(
      matchId,
      userId?.trim() || null,
      normalizedLimit,
    );
  }

  @Get('matches/:matchId/wall-state')
  async getWallState(
    @Param('matchId') matchId: string,
    @Query('user_id') userId?: string,
  ) {
    const normalizedUserId = userId?.trim();
    if (!normalizedUserId) {
      throw new BadRequestException('user_id is required.');
    }
    return this.sandboxService.getWallState(matchId, normalizedUserId);
  }

  @Post('matches/:matchId/wall-decision')
  async submitWallDecision(
    @Param('matchId') matchId: string,
    @Body() body: { user_id?: string; accept?: boolean },
  ) {
    const userId = body.user_id?.trim();
    if (!userId) {
      throw new BadRequestException('user_id is required.');
    }

    return this.sandboxService.submitWallDecision({
      matchId,
      userId,
      accept: body.accept === true,
    });
  }

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
