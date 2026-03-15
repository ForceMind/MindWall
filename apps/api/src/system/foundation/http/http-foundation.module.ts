import { Module } from '@nestjs/common';
import { TelemetryModule } from '../../../telemetry/telemetry.module';
import { GlobalHttpExceptionFilter } from './global-http-exception.filter';
import { HttpLoggingInterceptor } from './http-logging.interceptor';

@Module({
  imports: [TelemetryModule],
  providers: [GlobalHttpExceptionFilter, HttpLoggingInterceptor],
  exports: [GlobalHttpExceptionFilter, HttpLoggingInterceptor],
})
export class HttpFoundationModule {}
