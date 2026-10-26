import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Returns the E.164 form (e.g. +14155550123) or null when the number isn't valid. */
export function normalizePhone(input) {
  const parsed = parsePhoneNumberFromString(input.trim());
  return parsed && parsed.isValid() ? parsed.number : null;
}

/**
 * A phone number as someone types it when signing in or recovering an account: with a country code ("+91 98383 87338"),
 * or a bare 10-digit Indian mobile ("9838387338", +91 assumed). Returns E.164 or null.
 */
export function phoneFromTyped(text) {
  const t = text.trim();
  if (t.startsWith('+')) return normalizePhone(t);
  const digits = t.replace(/\D/g, '');
  return digits.length === 10 && /^[6-9]/.test(digits) && /^[\d\s().-]+$/.test(t) ? normalizePhone(`+91${digits}`) : null;
}

/** a***@gmail.com — enough to recognise your own address, not enough to guess someone else's. */
export function maskEmail(email) {
  const [name = '', domain = ''] = email.split('@');
  return `${name.slice(0, 1)}${'•'.repeat(Math.max(Math.min(name.length - 1, 5), 1))}@${domain}`;
}

/**
 * The rules for a sign-up mobile number, beyond "is a real number": at most 10 digits after the country code,
 * and for India (+91) exactly 10 digits starting with 6, 7, 8 or 9 (the phone library also allows landlines).
 * Returns a message to show, or null when the number is fine.
 */
export function mobileProblem(e164) {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return 'Enter a valid mobile number.';
  const national = String(parsed.nationalNumber);
  if (national.length > 10) return 'A mobile number can have at most 10 digits.';
  if (parsed.countryCallingCode === '91' && !/^[6-9]\d{9}$/.test(national)) return 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.';
  return null;
}

export function maskPhone(e164) {
  const parsed = parsePhoneNumberFromString(e164);
  const national = String(parsed?.nationalNumber ?? e164);
  return `+${parsed?.countryCallingCode ?? ''} ${'•'.repeat(Math.max(national.length - 3, 0))}${national.slice(-3)}`;
}
