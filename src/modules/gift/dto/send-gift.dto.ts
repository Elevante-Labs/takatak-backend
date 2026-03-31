import { IsUUID, IsString, IsNotEmpty } from 'class-validator';

export class SendGiftDto {
  @IsUUID()
  chatId!: string;

  @IsUUID()
  @IsNotEmpty()
  giftId!: string; // Changed to UUID to match DB schema

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}
