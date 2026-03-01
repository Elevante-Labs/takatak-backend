import { Module } from '@nestjs/common';
import { WithdrawalController, AdminWithdrawalController } from './withdrawal.controller';
import { WithdrawalService } from './withdrawal.service';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [WithdrawalController, AdminWithdrawalController],
  providers: [WithdrawalService],
  exports: [WithdrawalService],
})
export class WithdrawalModule {}
