import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsNotEmpty()
  @IsUUID()
  chatId!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  content!: string;
}
