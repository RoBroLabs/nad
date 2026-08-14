/**
 * Returns true only when both password fields contain the exact same string.
 * This is safe to share between client forms and server-side route validation.
 */
export function passwordsMatch(password: unknown, passwordConfirmation: unknown): boolean {
  return typeof password === 'string'
    && typeof passwordConfirmation === 'string'
    && password === passwordConfirmation;
}
