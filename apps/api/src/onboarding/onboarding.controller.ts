import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SessionUser } from '../auth/auth.types';
import { OnboardingService } from './onboarding.service';

interface StartSessionBody {
  auth_provider_id?: string;
  city?: string;
}

interface SendMessageBody {
  message?: string;
}

interface SaveBasicsBody {
  gender?: string;
  age?: number;
}

interface SaveCityBody {
  city?: string;
}

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('sessions')
  async startSession(@Body() body: StartSessionBody) {
    return this.onboardingService.startSession(body);
  }

  @Post('me/session')
  @UseGuards(SessionAuthGuard)
  async startMySession(
    @CurrentUser() user: SessionUser,
    @Body() body: Omit<StartSessionBody, 'auth_provider_id'>,
  ) {
    return this.onboardingService.startSessionForUser(user.userId, body);
  }

  @Post('me/profile')
  @UseGuards(SessionAuthGuard)
  async saveMyProfile(
    @CurrentUser() user: SessionUser,
    @Body() body: SaveBasicsBody,
  ) {
    return this.onboardingService.saveBasicsForUser(user.userId, body);
  }

  @Post('me/city')
  @UseGuards(SessionAuthGuard)
  async saveMyCity(
    @CurrentUser() user: SessionUser,
    @Body() body: SaveCityBody,
  ) {
    return this.onboardingService.saveCityForUser(user.userId, body);
  }

  @Post('sessions/:sessionId/messages')
  async sendMessage(
    @Param('sessionId') sessionId: string,
    @Body() body: SendMessageBody,
  ) {
    return this.onboardingService.submitMessage(sessionId, body);
  }

  @Post('me/session/:sessionId/messages')
  @UseGuards(SessionAuthGuard)
  async sendMyMessage(
    @CurrentUser() user: SessionUser,
    @Param('sessionId') sessionId: string,
    @Body() body: SendMessageBody,
  ) {
    return this.onboardingService.submitMessageForUser(sessionId, body, user.userId);
  }
}
