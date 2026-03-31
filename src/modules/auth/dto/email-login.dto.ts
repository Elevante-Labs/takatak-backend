import { IsEmail, IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class EmailLoginDto {
  @IsNotEmpty()
  @IsEmail()
  email!: string;

  @IsNotEmpty()
  @IsString()
  password!: string;

  @IsOptional()
  @IsString()
  deviceFingerprint?: string;
}
