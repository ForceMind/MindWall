import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SessionUser } from '../auth/auth.types';
import { ContactsService } from './contacts.service';

@Controller('contacts')
@UseGuards(SessionAuthGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get('me/list')
  async list(
    @CurrentUser() user: SessionUser,
    @Query('tab') tab?: string,
    @Query('page') page?: string,
  ) {
    const pageNum = parseInt(page || '1', 10);
    return this.contactsService.getConnectedContacts(user.userId, tab || 'active', pageNum);
  }

  @Get('me/candidates')
  async candidates(@CurrentUser() user: SessionUser) {
    return this.contactsService.getCandidateContacts(user.userId);
  }

  @Post('me/connect')
  async connect(
    @CurrentUser() user: SessionUser,
    @Body() body: { target_user_id?: string },
  ) {
    return this.contactsService.connectToUser(
      user.userId,
      body.target_user_id?.trim() || '',
    );
  }
}
