import { BadRequestException } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Normalize a phone number to E.164 format.
 * Defaults to 'IN' (India) if no country code prefix is detected.
 */
export function normalizePhone(phone: string): string {
  const parsed = parsePhoneNumberFromString(phone, 'IN');

  if (!parsed || !parsed.isValid()) {
    throw new BadRequestException('Invalid phone number');
  }

  return parsed.format('E.164');
}
