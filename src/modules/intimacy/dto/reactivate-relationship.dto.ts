import { IsUUID } from 'class-validator';

export class ReactivateRelationshipDto {
  @IsUUID()
  otherUserId!: string;
}
