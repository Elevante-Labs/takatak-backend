import { IsNotEmpty, IsString, Matches, IsOptional } from 'class-validator';

export class RequestOtpDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+?[1-9]\d{6,14}$/, {
    message: 'Phone number must be a valid international format',
  })
  phone!: string;

  @IsOptional()
  @IsString()
  deviceFingerprint?: string;
}
