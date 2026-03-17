import { Module } from '@nestjs/common';
import { DomainsModule } from './domains/domains.module';
import { FoundationModule } from './foundation/foundation.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [FoundationModule, DomainsModule, PlatformModule],
  exports: [FoundationModule, DomainsModule, PlatformModule],
})
export class BackendSystemModule {}
