import { Global, Module } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import { PromptTemplateService } from './prompt-template.service';
import { ServerLogService } from './server-log.service';

@Global()
@Module({
  providers: [AiUsageService, PromptTemplateService, ServerLogService],
  exports: [AiUsageService, PromptTemplateService, ServerLogService],
})
export class TelemetryModule {}
