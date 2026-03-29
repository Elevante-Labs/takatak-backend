import {
  Controller,
  Get,
  Put,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FraudService } from './fraud.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Controller('fraud')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN' as any)
export class FraudController {
  constructor(private readonly fraudService: FraudService) {}

  @Get('flags')
  async getFraudFlags(
    @Query() query: PaginationDto,
    @Query('type') type?: string,
    @Query('resolved') resolved?: string,
  ) {
    return this.fraudService.getFraudFlags(
      query.page,
      query.limit,
      type,
      resolved === 'true' ? true : resolved === 'false' ? false : undefined,
    );
  }

  @Get('user/:userId')
  async getUserFraudSummary(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.fraudService.getUserFraudSummary(userId);
  }

  @Put('flags/:flagId/resolve')
  async resolveFraudFlag(@Param('flagId', ParseUUIDPipe) flagId: string) {
    return this.fraudService.resolveFraudFlag(flagId);
  }
}
