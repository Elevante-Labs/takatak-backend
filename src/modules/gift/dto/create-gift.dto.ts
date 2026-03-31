import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsUrl,
  IsEnum,
  IsBoolean,
  IsISO8601,
  IsNumber,
} from 'class-validator';

enum GiftCategory {
  BASIC = 'BASIC',
  PREMIUM = 'PREMIUM',
  EVENT = 'EVENT',
  VIP = 'VIP',
  SPONSORED = 'SPONSORED',
}

enum GiftRarity {
  COMMON = 'COMMON',
  RARE = 'RARE',
  EPIC = 'EPIC',
  LEGENDARY = 'LEGENDARY',
}

export class CreateGiftDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUrl()
  @IsNotEmpty()
  iconUrl!: string;

  @IsOptional()
  @IsUrl()
  animationUrl?: string;

  @IsOptional()
  @IsUrl()
  animationUrl_full?: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  @IsNotEmpty()
  coinCost!: number;

  @IsInt()
  @Min(1)
  @Max(100000)
  @IsNotEmpty()
  diamondValue!: number;

  @IsEnum(GiftCategory)
  @IsOptional()
  category?: GiftCategory = GiftCategory.BASIC;

  @IsEnum(GiftRarity)
  @IsOptional()
  rarity?: GiftRarity = GiftRarity.COMMON;

  @IsInt()
  @IsOptional()
  displayOrder?: number = 0;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean = true;

  @IsBoolean()
  @IsOptional()
  isLimited?: boolean = false;

  @IsOptional()
  @IsISO8601()
  availableFrom?: string;

  @IsOptional()
  @IsISO8601()
  availableTill?: string;

  @IsInt()
  @Min(0)
  @Max(10)
  @IsOptional()
  minVipLevel?: number = 0;

  @IsNumber()
  @Min(1.0)
  @Max(5.0)
  @IsOptional()
  comboMultiplier?: number = 1.0;

  @IsOptional()
  @IsString()
  eventTag?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}
