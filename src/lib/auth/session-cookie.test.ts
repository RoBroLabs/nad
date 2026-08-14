import { describe, expect, it } from 'vitest';
import { shouldUseSecureSessionCookie } from '@/lib/auth/session-cookie';

describe('shouldUseSecureSessionCookie', () => {
  it('uses the secure Auth.js cookie when the canonical app URL is HTTPS', () => {
    expect(shouldUseSecureSessionCookie(
      'http://nad:3000/',
      'http',
      'https://nad.example.com',
    )).toBe(true);
  });

  it('uses the forwarded protocol when no canonical app URL is configured', () => {
    expect(shouldUseSecureSessionCookie(
      'http://nad:3000/',
      'https, http',
      undefined,
    )).toBe(true);
  });

  it('keeps local HTTP development on the non-secure cookie', () => {
    expect(shouldUseSecureSessionCookie(
      'http://127.0.0.1:3000/',
      null,
      undefined,
    )).toBe(false);
  });
});
