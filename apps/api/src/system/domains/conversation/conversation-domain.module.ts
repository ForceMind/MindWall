import { Module } from '@nestjs/common';
import { CompanionModule } from '../../../companion/companion.module';
import { SandboxModule } from '../../../sandbox/sandbox.module';

@Module({
  imports: [SandboxModule, CompanionModule],
  exports: [SandboxModule, CompanionModule],
})
export class ConversationDomainModule {}
