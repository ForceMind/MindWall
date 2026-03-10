import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
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
}
