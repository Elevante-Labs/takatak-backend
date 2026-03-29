import { IsInt, Min } from 'class-validator';

export class ConvertDiamondsDto {
  @IsInt()
  @Min(1)
  diamondAmount!: number;
}
