import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
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

export class UpdateGiftDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUrl()
  iconUrl?: string;

  @IsOptional()
  @IsUrl()
  animationUrl?: string;

  @IsOptional()
  @IsUrl()
  animationUrl_full?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  coinCost?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  diamondValue?: number;

  @IsOptional()
  @IsEnum(GiftCategory)
  category?: GiftCategory;

  @IsOptional()
  @IsEnum(GiftRarity)
  rarity?: GiftRarity;

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isLimited?: boolean;

  @IsOptional()
  @IsISO8601()
  availableFrom?: string;

  @IsOptional()
  @IsISO8601()
  availableTill?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  minVipLevel?: number;

  @IsOptional()
  @IsNumber()
  @Min(1.0)
  @Max(5.0)
  comboMultiplier?: number;

  @IsOptional()
  @IsString()
  eventTag?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}
