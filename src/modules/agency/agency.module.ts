import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AgencyController } from './agency.controller';
import { AgencyService } from './agency.service';
import { AgencyGateway } from './agency.gateway';
import { RedisModule } from '../../database/redis.module';

@Module({
  imports: [
    forwardRef(() => JwtModule),
    ConfigModule,
    RedisModule,
  ],
  controllers: [AgencyController],
  providers: [AgencyService, AgencyGateway],
  exports: [AgencyService],
})
export class AgencyModule implements OnModuleInit {
  constructor(
    private readonly agencyService: AgencyService,
    private readonly agencyGateway: AgencyGateway,
  ) { }

  onModuleInit() {
    // Wire the gateway into the service to avoid circular dependency
    this.agencyService.setGateway(this.agencyGateway);
  }
}
