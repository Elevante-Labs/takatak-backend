import { IsUUID } from 'class-validator';

export class InviteSubAgencyDto {
  @IsUUID()
  subAgencyId!: string;
}
