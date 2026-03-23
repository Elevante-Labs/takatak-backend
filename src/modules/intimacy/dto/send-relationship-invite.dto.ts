import { IsUUID, IsEnum } from 'class-validator';

export enum InviteRelationshipType {
  COUPLE = 'COUPLE',
  FRIEND = 'FRIEND',
}

export class SendRelationshipInviteDto {
  @IsUUID()
  otherUserId!: string;

  @IsEnum(InviteRelationshipType)
  type!: InviteRelationshipType;
}
