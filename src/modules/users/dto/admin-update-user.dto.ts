import { IsOptional, IsString, IsEnum, IsInt, Min, Max, IsBoolean } from 'class-validator';
import { Role } from '@prisma/client';

export class AdminUpdateUserDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  vipLevel?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  country?: string;
}
