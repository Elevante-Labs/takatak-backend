import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreateChatDto {
  /** Target user ID (HOST or USER) */
  @IsNotEmpty()
  @IsUUID()
  targetId!: string;
}
