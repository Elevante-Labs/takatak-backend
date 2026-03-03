import { Module, forwardRef } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { GiftProcessorService } from './gift-processor.service';
import { AgencyModule } from '../agency/agency.module';
import { HostModule } from '../host/host.module';

@Module({
  imports: [
    forwardRef(() => AgencyModule),
    forwardRef(() => HostModule),
  ],
  controllers: [WalletController],
  providers: [WalletService, GiftProcessorService],
  exports: [WalletService],
})
export class WalletModule {}
