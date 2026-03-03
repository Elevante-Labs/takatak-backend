import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AgencyService } from './agency.service';
import { CreateAgencyDto } from './dto/create-agency.dto';
import { AddHostToAgencyDto } from './dto/add-host.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('agency')
@UseGuards(AuthGuard('jwt'))
export class AgencyController {
  constructor(private readonly agencyService: AgencyService) {}

  /**
   * Create a new agency
   */
  @Post()
  async createAgency(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAgencyDto,
  ) {
    return this.agencyService.createAgency(user.sub, dto);
  }

  /**
   * Get my agency details and dashboard
   */
  @Get('me')
  async getMyAgency(@CurrentUser() user: JwtPayload) {
    return this.agencyService.getMyAgency(user.sub);
  }

  /**
   * Get agency dashboard with commission stats
   */
  @Get('dashboard')
  async getDashboard(@CurrentUser() user: JwtPayload) {
    return this.agencyService.getAgencyDashboard(user.sub);
  }

  /**
   * Get commission history
   */
  @Get('commission-history')
  async getCommissionHistory(
    @CurrentUser() user: JwtPayload,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.agencyService.getCommissionHistory(user.sub, page, limit);
  }

  /**
   * Get a specific agency by ID
   */
  @Get(':id')
  async getAgency(@Param('id') id: string) {
    return this.agencyService.getAgency(id);
  }

  /**
   * Add a host to my agency
   */
  @Post('hosts')
  async addHost(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AddHostToAgencyDto,
  ) {
    const agency = await this.agencyService.getMyAgency(user.sub);
    return this.agencyService.addHostToAgency(agency.id, user.sub, dto.hostUserId);
  }

  /**
   * Remove a host from my agency
   */
  @Delete('hosts/:hostUserId')
  async removeHost(
    @CurrentUser() user: JwtPayload,
    @Param('hostUserId') hostUserId: string,
  ) {
    const agency = await this.agencyService.getMyAgency(user.sub);
    return this.agencyService.removeHostFromAgency(agency.id, user.sub, hostUserId);
  }

  /**
   * Ban/unban an agency (admin only)
   */
  @Post(':id/ban')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async banAgency(@Param('id') id: string) {
    return this.agencyService.setAgencyBanStatus(id, true);
  }

  @Post(':id/unban')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async unbanAgency(@Param('id') id: string) {
    return this.agencyService.setAgencyBanStatus(id, false);
  }
}
