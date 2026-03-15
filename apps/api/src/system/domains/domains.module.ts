import { Module } from '@nestjs/common';
import { ConversationDomainModule } from './conversation/conversation-domain.module';
import { IdentityDomainModule } from './identity/identity-domain.module';
import { MatchingDomainModule } from './matching/matching-domain.module';
import { OnboardingDomainModule } from './onboarding/onboarding-domain.module';

@Module({
  imports: [
    IdentityDomainModule,
    OnboardingDomainModule,
    MatchingDomainModule,
    ConversationDomainModule,
  ],
  exports: [
    IdentityDomainModule,
    OnboardingDomainModule,
    MatchingDomainModule,
    ConversationDomainModule,
  ],
})
export class DomainsModule {}
