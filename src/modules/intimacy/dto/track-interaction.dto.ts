import { IsUUID, IsEnum, IsOptional, IsObject, IsNumber } from 'class-validator';

export enum InteractionType {
  CHAT = 'CHAT',
  GIFT = 'GIFT',
  CALL = 'CALL',
  ROOM = 'ROOM',
}

export class TrackInteractionDto {
  @IsUUID()
  otherUserId!: string;

  @IsEnum(InteractionType)
  type!: InteractionType;

  @IsOptional()
  @IsNumber()
  replySpeedMs?: number;

  @IsOptional()
  @IsNumber()
  giftCoins?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
