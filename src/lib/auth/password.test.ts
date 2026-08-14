import { describe, expect, it } from 'vitest';
import { passwordsMatch } from '@/lib/auth/password';

describe('passwordsMatch', () => {
  it('accepts matching password strings', () => {
    expect(passwordsMatch('correct horse battery staple', 'correct horse battery staple')).toBe(true);
  });

  it('rejects mismatched and non-string values', () => {
    expect(passwordsMatch('first-password', 'second-password')).toBe(false);
    expect(passwordsMatch('password', undefined)).toBe(false);
    expect(passwordsMatch(undefined, undefined)).toBe(false);
  });
});
