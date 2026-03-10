import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MatchEngineService } from './match-engine.service';

interface RunMatchEngineBody {
  city?: string;
  max_matches_per_user?: number;
  min_score?: number;
  dry_run?: boolean;
}

@Controller('match-engine')
export class MatchEngineController {
  constructor(private readonly matchEngineService: MatchEngineService) {}

  @Post('run')
  async run(@Body() body: RunMatchEngineBody) {
    return this.matchEngineService.run(body);
  }

  @Get('users/:userId/matches')
  async getUserMatches(@Param('userId') userId: string) {
    return this.matchEngineService.getUserMatches(userId);
  }
}
