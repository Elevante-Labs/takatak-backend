import { IsUUID, IsString, IsNotEmpty, IsOptional, IsEnum, IsUrl } from 'class-validator';

export enum MessageTypeDto {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  EMOJI = 'EMOJI',
}

export class SendMessageDto {
  @IsUUID()
  chatId!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsOptional()
  @IsEnum(MessageTypeDto)
  messageType?: MessageTypeDto;

  @IsOptional()
  @IsString()
  mediaUrl?: string;
}
