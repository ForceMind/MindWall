import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CompanionModule } from './companion/companion.module';
import { MatchEngineModule } from './match-engine/match-engine.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PrismaModule } from './prisma/prisma.module';
import { SandboxModule } from './sandbox/sandbox.module';

@Module({
  imports: [
    AdminModule,
    AuthModule,
    CompanionModule,
    PrismaModule,
    OnboardingModule,
    MatchEngineModule,
    SandboxModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
