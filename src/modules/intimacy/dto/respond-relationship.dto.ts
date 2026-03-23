import { IsUUID, IsEnum } from 'class-validator';

export enum RelationshipResponse {
  ACCEPT = 'ACCEPT',
  REJECT = 'REJECT',
}

export class RespondRelationshipDto {
  @IsUUID()
  relationshipId!: string;

  @IsEnum(RelationshipResponse)
  response!: RelationshipResponse;
}
