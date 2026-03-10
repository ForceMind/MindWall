import { Global, Module } from '@nestjs/common';
import { AdminConfigService } from './admin-config.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';

@Global()
@Module({
  controllers: [AdminController],
  providers: [AdminConfigService, AdminGuard],
  exports: [AdminConfigService],
})
export class AdminModule {}
