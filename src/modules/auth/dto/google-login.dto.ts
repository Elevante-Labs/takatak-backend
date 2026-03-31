import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class GoogleLoginDto {
  @IsNotEmpty()
  @IsString()
  idToken!: string;

  @IsOptional()
  @IsString()
  deviceFingerprint?: string;
}
