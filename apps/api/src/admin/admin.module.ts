import { Global, Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminBackupController } from './admin-backup.controller';
import { AdminBackupService } from './admin-backup.service';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminConfigService } from './admin-config.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';

@Global()
@Module({
  controllers: [AdminAuthController, AdminController, AdminDashboardController, AdminBackupController],
  providers: [
    AdminAuthService,
    AdminBackupService,
    AdminConfigService,
    AdminDashboardService,
    AdminGuard,
  ],
  exports: [AdminAuthService, AdminConfigService, AdminDashboardService],
})
export class AdminModule {}
