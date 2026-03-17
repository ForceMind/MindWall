import { Module } from '@nestjs/common';
import { AdminPlatformModule } from './admin/admin-platform.module';
import { OpsPlatformModule } from './ops/ops-platform.module';

@Module({
  imports: [AdminPlatformModule, OpsPlatformModule],
  exports: [AdminPlatformModule, OpsPlatformModule],
})
export class PlatformModule {}
