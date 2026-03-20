import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { AdminConfigService } from './admin/admin-config.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly adminConfigService: AdminConfigService,
  ) {}

  @Get()
  getServiceInfo() {
    return this.appService.getServiceInfo();
  }

  @Get('maintenance-status')
  getMaintenanceStatus() {
    return this.adminConfigService.getMaintenanceStatus();
  }
}
