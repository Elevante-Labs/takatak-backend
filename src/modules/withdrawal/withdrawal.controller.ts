import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WithdrawalService } from './withdrawal.service';
import { CreateWithdrawalDto, RejectWithdrawalDto } from './dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Controller('wallet/withdrawals')
@UseGuards(AuthGuard('jwt'))
export class WithdrawalController {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  /** Host creates a withdrawal request */
  @Post()
  async createWithdrawal(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateWithdrawalDto,
  ) {
    return this.withdrawalService.createWithdrawalRequest(
      user.sub,
      dto.diamondAmount,
    );
  }

  /** User views their own withdrawal history */
  @Get('mine')
  async getMyWithdrawals(
    @CurrentUser() user: JwtPayload,
    @Query() query: PaginationDto,
  ) {
    return this.withdrawalService.getUserWithdrawals(
      user.sub,
      query.page,
      query.limit,
    );
  }
}

@Controller('admin/withdrawals')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN' as any)
export class AdminWithdrawalController {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  /** Admin views all withdrawal requests */
  @Get()
  async getAll(
    @Query() query: PaginationDto,
    @Query('status') status?: string,
  ) {
    return this.withdrawalService.getWithdrawalRequests(
      query.page,
      query.limit,
      status,
    );
  }

  /** Admin approves a withdrawal request */
  @Put(':id/approve')
  async approve(
    @Param('id') id: string,
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.withdrawalService.approveWithdrawal(id, admin.sub);
  }

  /** Admin rejects a withdrawal request (refunds diamonds) */
  @Put(':id/reject')
  async reject(
    @Param('id') id: string,
    @CurrentUser() admin: JwtPayload,
    @Body() dto: RejectWithdrawalDto,
  ) {
    return this.withdrawalService.rejectWithdrawal(
      id,
      admin.sub,
      dto.adminNote,
    );
  }
}
