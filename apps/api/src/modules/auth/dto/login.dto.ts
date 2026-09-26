import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@localhost.local' })
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password: string;

  /** When set, only users assigned to this pharmacy (via invitation) may sign in. */
  @ApiPropertyOptional({ example: 'al-amal' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i, {
    message: 'pharmacySlug must be a valid pharmacy slug',
  })
  pharmacySlug?: string;
}
