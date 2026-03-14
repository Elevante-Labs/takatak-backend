import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { UpdateUserDto, AdminUpdateUserDto } from './dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Controller('users')
@UseGuards(AuthGuard('jwt'))
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: JwtPayload) {
    return this.usersService.findById(user.sub);
  }

  @Put('me')
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateProfile(user.sub, dto);
  }

  @Get('hosts')
  async getOnlineHosts(@Query() query: PaginationDto) {
    return this.usersService.getOnlineHosts(query.page, query.limit);
  }

  @Get('chat-partners')
  async getChatPartners(
    @CurrentUser() user: JwtPayload,
    @Query() query: PaginationDto,
  ) {
    return this.usersService.getChatPartners(user.sub, query.page, query.limit);
  }

  @Get(':id')
  async getUserById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(id);
  }

  // Admin endpoints
  @Get()
  @Roles('ADMIN' as any)
  @UseGuards(RolesGuard)
  async listUsers(
    @Query() query: PaginationDto,
    @Query('role') role?: string,
  ) {
    return this.usersService.listUsers(query.page, query.limit, role);
  }

  @Put(':id/admin')
  @Roles('ADMIN' as any)
  @UseGuards(RolesGuard)
  async adminUpdateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return this.usersService.adminUpdateUser(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN' as any)
  @UseGuards(RolesGuard)
  async deleteUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.softDelete(id);
  }
}
