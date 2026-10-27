import { z } from 'zod';
import { isId } from '../../lib/ids.js';

const RESERVED = new Set(['admin', 'administrator', 'socialambak', 'ambak', 'support', 'help', 'root', 'system', 'security', 'official', 'moderator']);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._]{3,30}$/, 'Use 3–30 letters, numbers, periods or underscores.')
  .refine((v) => !v.startsWith('.') && !v.endsWith('.') && !v.includes('..'), "Periods can't start or end a username, or sit next to each other.")
  .refine((v) => !RESERVED.has(v), 'That username is reserved.');

export const emailSchema = z.string().trim().toLowerCase().max(254).email('Enter a valid email address.');

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(128, 'Use 128 characters or fewer.')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number.');

function ageOn(dob, today = new Date()) {
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export const channelSchema = z.enum(['email', 'phone']);

export const signupSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Enter your name.').max(60, 'Use 60 characters or fewer.'),
    username: usernameSchema,
    // Optional: a blank email means "none". It is required only when the sign-up code is to be sent to the email.
    email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), emailSchema.optional()),
    phone: z.string().trim().min(6, 'Enter your phone number.').max(24),
    password: passwordSchema,
    // Where the single sign-up code goes. The other contact is saved but stays unverified.
    verifyVia: channelSchema.default('phone'),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter your date of birth.')
      .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Enter a real date.')
      .refine((v) => ageOn(new Date(v)) >= 13, 'You must be at least 13 to use SocialAmbak.')
      .refine((v) => ageOn(new Date(v)) <= 120, 'Enter a real date of birth.'),
  })
  .superRefine((v, ctx) => {
    if (v.verifyVia === 'email' && !v.email) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Enter your email to get the code there.' });
    if (v.password.toLowerCase().includes(v.username)) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: "Your password can't contain your username." });
    }
  });

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your username, email or phone.').max(254),
  password: z.string().min(1, 'Enter your password.').max(128),
});

// Account recovery (forgot password / forgot username). `channel` only matters when the person typed a username:
// an email or phone number already says where the code goes.
export const recoverStartSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your username, email or phone.').max(254),
  channel: channelSchema.optional(),
});

const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code.');

export const recoverVerifySchema = z.object({ ticket: z.string().min(10).max(1000), code: codeSchema });

export const recoverResetSchema = z.object({
  ticket: z.string().min(10).max(1000),
  userId: z.string().refine(isId, 'Invalid id.'),
  password: passwordSchema,
});

export const verifySchema = z.object({
  ticket: z.string().min(10).max(1000),
  channel: channelSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

export const resendSchema = z.object({
  ticket: z.string().min(10).max(1000),
  channel: channelSchema,
});

export const availabilitySchema = z.object({ username: z.string().optional(), email: z.string().optional() }).refine((v) => v.username || v.email, 'Provide a username or email to check.');
