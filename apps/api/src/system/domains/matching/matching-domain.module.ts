import { Module } from '@nestjs/common';
import { ContactsModule } from '../../../contacts/contacts.module';
import { MatchEngineModule } from '../../../match-engine/match-engine.module';

@Module({
  imports: [ContactsModule, MatchEngineModule],
  exports: [ContactsModule, MatchEngineModule],
})
export class MatchingDomainModule {}
