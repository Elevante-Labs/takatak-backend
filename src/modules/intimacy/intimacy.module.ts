import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IntimacyController } from './intimacy.controller';
import { IntimacyEngineService } from './intimacy.service';
import { RelationshipService } from './relationship.service';
import { FeatureGateService } from './feature-gate.service';
import { IntimacyCronService } from './intimacy-cron.service';
import { IntimacyGateway } from './intimacy.gateway';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [IntimacyController],
  providers: [
    IntimacyEngineService,
    RelationshipService,
    FeatureGateService,
    IntimacyCronService,
    IntimacyGateway,
  ],
  exports: [IntimacyEngineService, FeatureGateService, IntimacyGateway],
})
export class IntimacyModule {}
