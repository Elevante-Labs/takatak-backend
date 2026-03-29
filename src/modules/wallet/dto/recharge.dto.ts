import { IsInt, Min, IsEnum, IsOptional, IsString } from 'class-validator';

export enum CoinType {
  GIFT = 'GIFT',
  GAME = 'GAME',
}

export class RechargeDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsEnum(CoinType)
  coinType!: CoinType;

  @IsOptional()
  @IsString()
  description?: string;
}
