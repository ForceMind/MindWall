import { Module } from '@nestjs/common';
import { MatchEngineController } from './match-engine.controller';
import { MatchEngineService } from './match-engine.service';

@Module({
  controllers: [MatchEngineController],
  providers: [MatchEngineService],
})
export class MatchEngineModule {}
