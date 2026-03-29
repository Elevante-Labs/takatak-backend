import { IsEnum, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export enum RoleFilter {
  USER = 'USER',
  HOST = 'HOST',
  AGENCY = 'AGENCY',
  ADMIN = 'ADMIN',
}

export class AvailableUsersQueryDto {
  @IsEnum(RoleFilter, {
    message: 'Invalid role. Accepted: HOST, USER, AGENCY, ADMIN',
  })
  role!: RoleFilter;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
