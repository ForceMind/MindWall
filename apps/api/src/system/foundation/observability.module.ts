import { Module } from '@nestjs/common';
import { TelemetryModule } from '../../telemetry/telemetry.module';

@Module({
  imports: [TelemetryModule],
  exports: [TelemetryModule],
})
export class ObservabilityModule {}
