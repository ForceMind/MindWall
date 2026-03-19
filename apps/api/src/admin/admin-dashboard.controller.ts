import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { AdminGuard } from './admin.guard';
import { AdminDashboardService } from './admin-dashboard.service';

@Controller('admin/dashboard')
@UseGuards(AdminGuard)
export class AdminDashboardController {
  constructor(private readonly adminDashboardService: AdminDashboardService) {}

  @Get('overview')
  async overview() {
    return this.adminDashboardService.getOverview();
  }

  @Get('users')
  async users(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminDashboardService.listUsers(
      Number(page || 1),
      Number(limit || 20),
    );
  }

  @Get('users/:userId/detail')
  async userDetail(@Param('userId') userId: string) {
    return this.adminDashboardService.getUserDetail(userId);
  }

  @Get('online')
  async online(@Query('minutes') minutes?: string) {
    return this.adminDashboardService.listOnlineUsers(Number(minutes || 5));
  }

  @Put('users/:userId/status')
  async updateUserStatus(
    @Param('userId') userId: string,
    @Body('status', new ParseEnumPipe(UserStatus)) status: UserStatus,
  ) {
    return this.adminDashboardService.updateUserStatus(userId, status);
  }

  @Get('ai-records')
  async aiRecords(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminDashboardService.getAiRecords(
      Number(page || 1),
      Number(limit || 20),
    );
  }

  @Get('prompts')
  async prompts() {
    return this.adminDashboardService.getPrompts();
  }

  @Get('matches')
  async matches(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('tab') tab?: string,
    @Query('search') search?: string,
  ) {
    return this.adminDashboardService.listMatches(
      Number(page || 1),
      Number(limit || 20),
      tab,
      search,
    );
  }

  @Get('companion-sessions')
  async companionSessions(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('tab') tab?: string,
    @Query('search') search?: string,
  ) {
    return this.adminDashboardService.listCompanionSessions(
      Number(page || 1),
      Number(limit || 20),
      tab,
      search,
    );
  }

  @Get('companion-sessions/:sessionId/messages')
  async companionSessionMessages(@Param('sessionId') sessionId: string) {
    return this.adminDashboardService.getCompanionSessionMessages(sessionId);
  }

  @Get('matches/:matchId/messages')
  async matchMessages(
    @Param('matchId') matchId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminDashboardService.getMatchMessages(
      matchId,
      Number(page || 1),
      Number(limit || 50),
    );
  }

  @Put('prompts/:key')
  async updatePrompt(
    @Param('key') key: string,
    @Body()
    body: {
      name?: string;
      category?: string;
      content?: string;
      is_active?: boolean;
    },
  ) {
    return this.adminDashboardService.updatePrompt(key, body);
  }

  @Get('logs')
  async logs(
    @Query('lines') lines?: string,
    @Query('category') category?: string,
    @Query('level') level?: string,
  ) {
    return this.adminDashboardService.getServerLogs(Number(lines || 200), category, level);
  }
}
