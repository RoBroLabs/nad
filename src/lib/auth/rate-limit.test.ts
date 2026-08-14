import { describe, expect, it } from 'vitest';
import { consumeRateLimit, getClientAddress } from '@/lib/auth/rate-limit';

describe('getClientAddress', () => {
  it('prefers the proxy-overwritten real client address', () => {
    const request = new Request('https://nad.example.test', {
      headers: {
        'x-real-ip': '192.168.1.42',
        'x-forwarded-for': '203.0.113.99, 192.168.1.42',
      },
    });

    expect(getClientAddress(request)).toBe('192.168.1.42');
  });

  it('uses the rightmost valid forwarded hop when real IP is absent', () => {
    const request = new Request('https://nad.example.test', {
      headers: {
        'x-forwarded-for': 'spoofed, 203.0.113.99, 192.168.1.42',
      },
    });

    expect(getClientAddress(request)).toBe('192.168.1.42');
  });

  it('does not retain malformed header content', () => {
    const request = new Request('https://nad.example.test', {
      headers: {
        'x-real-ip': 'not-an-ip',
        'x-forwarded-for': 'also-not-an-ip',
      },
    });

    expect(getClientAddress(request)).toBe('unknown');
  });
});

describe('consumeRateLimit', () => {
  it('flags the single request that exhausts the allowance, then blocks the rest', () => {
    const key = 'test:becameBlocked';
    const results = Array.from({ length: 3 }, () => consumeRateLimit(key, 3, 60_000));

    expect(results.map(({ allowed }) => allowed)).toEqual([true, true, true]);
    expect(results.map(({ becameBlocked }) => becameBlocked)).toEqual([undefined, undefined, true]);

    const blocked = consumeRateLimit(key, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.becameBlocked).toBeUndefined();
  });
});
