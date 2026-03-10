import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MatchEngineModule } from './match-engine/match-engine.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PrismaModule } from './prisma/prisma.module';
import { SandboxModule } from './sandbox/sandbox.module';

@Module({
  imports: [
    AdminModule,
    PrismaModule,
    OnboardingModule,
    MatchEngineModule,
    SandboxModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
