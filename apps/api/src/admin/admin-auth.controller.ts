import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin.guard';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  async login(@Body() body: { username?: string; password?: string }) {
    return this.adminAuthService.login(body);
  }

  @Get('session')
  @UseGuards(AdminGuard)
  async session(
    @Headers('authorization') authorization?: string,
    @Headers('x-admin-token') adminTokenHeader?: string,
  ) {
    return this.adminAuthService.getCurrentSession({
      authorization,
      adminTokenHeader,
    });
  }

  @Post('logout')
  async logout(@Headers('authorization') authorization?: string) {
    return this.adminAuthService.logout(authorization);
  }
}
