import { IsNotEmpty, IsString } from 'class-validator';

export class CreateReferralDto {
  @IsNotEmpty()
  @IsString()
  referralCode!: string;
}
