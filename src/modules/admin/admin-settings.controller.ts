import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminSettingsService } from './admin-settings.service';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('admin/settings')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN' as any)
export class AdminSettingsController {
  constructor(
    private readonly adminSettingsService: AdminSettingsService,
  ) {}

  /** Get all system settings */
  @Get()
  async getAll() {
    return this.adminSettingsService.getAll();
  }

  /** Get a single setting */
  @Get(':key')
  async getByKey(@Param('key') key: string) {
    return this.adminSettingsService.getByKey(key);
  }

  /** Update a setting */
  @Put(':key')
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.adminSettingsService.updateSetting(
      key,
      dto.value,
      admin.sub,
    );
  }
}
