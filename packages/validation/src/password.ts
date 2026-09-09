import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@pm/types';

/**
 * A deliberately small blocklist of passwords that pass a naive complexity
 * check but are among the first things any attacker tries. Full dictionary
 * scoring (zxcvbn) is a Phase 7 hardening item; this is not presented as
 * more than it is.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd123',
  'qwerty123456',
  'administrator',
  'letmein12345',
  'welcome12345',
  'iloveyou1234',
  'changeme1234',
  'propertymanager',
  'propertymanagement',
  'landlord1234',
]);

export interface PasswordProblem {
  code: string;
  message: string;
}

/**
 * The single definition of "is this password acceptable".
 *
 * The API calls this and rejects the request; the web app calls the same
 * function so the user sees the rule before submitting. There is one
 * implementation, so the two can never disagree.
 */
export function checkPassword(password: string, context: { email?: string } = {}): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  const value = password ?? '';

  if (value.length < PASSWORD_MIN_LENGTH) {
    problems.push({
      code: 'TOO_SHORT',
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    });
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    problems.push({
      code: 'TOO_LONG',
      message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    });
  }
  if (!/[a-z]/.test(value)) {
    problems.push({ code: 'NO_LOWERCASE', message: 'Password must contain a lowercase letter.' });
  }
  if (!/[A-Z]/.test(value)) {
    problems.push({ code: 'NO_UPPERCASE', message: 'Password must contain an uppercase letter.' });
  }
  if (!/[0-9]/.test(value)) {
    problems.push({ code: 'NO_DIGIT', message: 'Password must contain a number.' });
  }
  if (COMMON_PASSWORDS.has(value.toLowerCase())) {
    problems.push({ code: 'TOO_COMMON', message: 'This password is too common. Choose another.' });
  }

  const localPart = context.email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && value.toLowerCase().includes(localPart)) {
    problems.push({
      code: 'CONTAINS_EMAIL',
      message: 'Password must not contain your email address.',
    });
  }

  return problems;
}

export function isPasswordAcceptable(password: string, context: { email?: string } = {}): boolean {
  return checkPassword(password, context).length === 0;
}

/** 0–4, for the strength meter only. Never used to accept or reject. */
export function passwordStrengthScore(password: string): number {
  let score = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}
