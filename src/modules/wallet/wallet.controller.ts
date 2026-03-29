import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WalletService } from './wallet.service';
import { RechargeDto, ConvertCoinsDto, ConvertDiamondsDto } from './dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Controller('wallet')
@UseGuards(AuthGuard('jwt'))
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('balance')
  async getBalance(@CurrentUser() user: JwtPayload) {
    return this.walletService.getBalance(user.sub);
  }

  @Post('recharge')
  @Roles('ADMIN' as any)
  @UseGuards(RolesGuard)
  async recharge(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RechargeDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ) {
    return this.walletService.recharge(
      user.sub,
      dto.amount,
      dto.coinType,
      dto.description,
      idempotencyKey,
    );
  }

  @Post('convert/coins-to-diamonds')
  async convertCoinsToDiamonds(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConvertCoinsDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ) {
    return this.walletService.convertCoinsToDiamonds(
      user.sub,
      dto.coinAmount,
      idempotencyKey,
    );
  }

  @Post('convert/diamonds-to-coins')
  async convertDiamondsToCoins(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConvertDiamondsDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ) {
    return this.walletService.convertDiamondsToCoins(
      user.sub,
      dto.diamondAmount,
      idempotencyKey,
    );
  }

  @Post('daily-bonus')
  async claimDailyBonus(@CurrentUser() user: JwtPayload) {
    return this.walletService.awardDailyBonus(user.sub);
  }

  @Get('transactions')
  async getTransactions(
    @CurrentUser() user: JwtPayload,
    @Query() query: PaginationDto,
  ) {
    return this.walletService.getTransactionHistory(
      user.sub,
      query.page,
      query.limit,
    );
  }
}
