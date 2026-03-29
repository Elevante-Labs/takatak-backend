import { IsNotEmpty, IsString, Matches, Length, IsOptional } from 'class-validator';

export class VerifyOtpDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+?[1-9]\d{6,14}$/, {
    message: 'Phone number must be a valid international format',
  })
  phone!: string;

  @IsNotEmpty()
  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  code!: string;

  @IsOptional()
  @IsString()
  deviceFingerprint?: string;

  @IsOptional()
  @IsString()
  referralCode?: string;
}
