import { IsUUID } from 'class-validator';

export class AddHostToAgencyDto {
  @IsUUID()
  hostUserId: string;
}
