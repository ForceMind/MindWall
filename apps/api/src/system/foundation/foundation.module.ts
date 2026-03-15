import { Module } from '@nestjs/common';
import { HttpFoundationModule } from './http/http-foundation.module';
import { ObservabilityModule } from './observability.module';
import { PersistenceModule } from './persistence.module';

@Module({
  imports: [PersistenceModule, ObservabilityModule, HttpFoundationModule],
  exports: [PersistenceModule, ObservabilityModule, HttpFoundationModule],
})
export class FoundationModule {}
