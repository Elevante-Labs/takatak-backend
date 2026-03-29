import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectWithdrawalDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  adminNote?: string;
}
