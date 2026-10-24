// Client-side checks mirror the server's rules so people see problems before submitting.
// The server re-validates everything; these are for speed, not security.

export const rules = {
  fullName: (v) => (!v.trim() ? 'Enter your name.' : v.trim().length > 60 ? 'Use 60 characters or fewer.' : ''),
  username: (v) => {
    const u = v.trim().toLowerCase();
    if (!u) return 'Choose a username.';
    if (!/^[a-z0-9._]{3,30}$/.test(u)) return 'Use 3–30 letters, numbers, periods or underscores.';
    if (u.startsWith('.') || u.endsWith('.') || u.includes('..')) return "Periods can't start or end a username, or sit next to each other.";
    return '';
  },
  email: (v) => (!v.trim() ? 'Enter your email.' : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? 'Enter a valid email address.' : ''),
  // Mobile numbers are at most 10 digits. India (+91) must be exactly 10 digits starting with 6, 7, 8 or 9.
  phone: (v, iso = 'IN') => {
    const digits = v.replace(/\D/g, '');
    if (!digits) return 'Enter your mobile number.';
    if (digits.length > 10) return 'A mobile number can have at most 10 digits.';
    if (iso === 'IN') {
      if (digits.length !== 10) return 'Enter a 10-digit mobile number.';
      if (!/^[6-9]/.test(digits)) return 'An Indian mobile number starts with 6, 7, 8 or 9.';
      return '';
    }
    if (digits.length < 6) return 'Enter a valid mobile number.';
    return '';
  },
  password: (v, username = '') => {
    if (v.length < 8) return 'Use at least 8 characters.';
    if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return 'Include at least one letter and one number.';
    if (username && v.toLowerCase().includes(username.toLowerCase())) return "Your password can't contain your username.";
    return '';
  },
  dateOfBirth: (v) => {
    if (!v) return 'Enter your date of birth.';
    const dob = new Date(v);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    if (now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) age--;
    if (age < 13) return 'You must be at least 13 to use SocialAmbak.';
    if (age > 120) return 'Enter a real date of birth.';
    return '';
  },
};

export const COUNTRIES = [
  { iso: 'IN', name: 'India', dial: '91' },
  { iso: 'US', name: 'United States', dial: '1' },
  { iso: 'CA', name: 'Canada', dial: '1' },
  { iso: 'GB', name: 'United Kingdom', dial: '44' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971' },
  { iso: 'AU', name: 'Australia', dial: '61' },
  { iso: 'SG', name: 'Singapore', dial: '65' },
  { iso: 'DE', name: 'Germany', dial: '49' },
  { iso: 'FR', name: 'France', dial: '33' },
  { iso: 'BR', name: 'Brazil', dial: '55' },
  { iso: 'NG', name: 'Nigeria', dial: '234' },
  { iso: 'ZA', name: 'South Africa', dial: '27' },
  { iso: 'JP', name: 'Japan', dial: '81' },
];

/** Picks a starting country from the browser's language region, e.g. en-GB → GB. */
/** The country selected when the sign-up page opens. */
export const DEFAULT_COUNTRY = 'IN';

export function guessCountry() {
  const region = navigator.language.split('-')[1]?.toUpperCase();
  return COUNTRIES.some((c) => c.iso === region) ? region : DEFAULT_COUNTRY;
}
