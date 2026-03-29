import { IsInt, Min } from 'class-validator';

export class ConvertCoinsDto {
  @IsInt()
  @Min(1)
  coinAmount!: number;
}
