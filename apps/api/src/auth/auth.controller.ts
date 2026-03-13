import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SessionAuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { SessionUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body()
    body: { username?: string; password?: string },
  ) {
    return this.authService.register(body);
  }

  @Post('login')
  async login(@Body() body: { username?: string; password?: string }) {
    return this.authService.login(body);
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async me(@CurrentUser() user: SessionUser) {
    return this.authService.getMe(user.userId);
  }

  @Post('logout')
  @UseGuards(SessionAuthGuard)
  async logout(@CurrentUser() user: SessionUser) {
    return this.authService.logout(user.sessionId);
  }
}
