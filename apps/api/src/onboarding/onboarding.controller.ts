import { Body, Controller, Param, Post } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

interface StartSessionBody {
  auth_provider_id?: string;
  city?: string;
}

interface SendMessageBody {
  message?: string;
}

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('sessions')
  async startSession(@Body() body: StartSessionBody) {
    return this.onboardingService.startSession(body);
  }

  @Post('sessions/:sessionId/messages')
  async sendMessage(
    @Param('sessionId') sessionId: string,
    @Body() body: SendMessageBody,
  ) {
    return this.onboardingService.submitMessage(sessionId, body);
  }
}
