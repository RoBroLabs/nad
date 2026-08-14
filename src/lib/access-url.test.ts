import { describe, expect, it } from 'vitest';
import { getRequestOrigin, originsMatch, parseCanonicalUrl } from '@/lib/access-url';

describe('parseCanonicalUrl', () => {
  it('accepts HTTPS origins with and without a trailing slash', () => {
    expect(parseCanonicalUrl('https://nad.example.com')).toBe('https://nad.example.com');
    expect(parseCanonicalUrl('https://nad.example.com/')).toBe('https://nad.example.com');
  });

  it('accepts HTTP origins with explicit ports and IP literals', () => {
    expect(parseCanonicalUrl('http://192.168.1.15:3000')).toBe('http://192.168.1.15:3000');
    expect(parseCanonicalUrl('http://[::1]:3000')).toBe('http://[::1]:3000');
    expect(parseCanonicalUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('normalises case and default ports', () => {
    expect(parseCanonicalUrl('https://NAD.EXAMPLE.COM:443')).toBe('https://nad.example.com');
    expect(parseCanonicalUrl('http://nad.example.com:80/')).toBe('http://nad.example.com');
  });

  it('rejects non-HTTP schemes, credentials, paths, query strings, and fragments', () => {
    expect(parseCanonicalUrl('ftp://nad.example.com')).toBeNull();
    expect(parseCanonicalUrl('https://user:password@nad.example.com')).toBeNull();
    expect(parseCanonicalUrl('https://nad.example.com/base')).toBeNull();
    expect(parseCanonicalUrl('https://nad.example.com/?x=1')).toBeNull();
    expect(parseCanonicalUrl('https://nad.example.com/#section')).toBeNull();
  });

  it('rejects empty, relative, and overlong values', () => {
    expect(parseCanonicalUrl('')).toBeNull();
    expect(parseCanonicalUrl('   ')).toBeNull();
    expect(parseCanonicalUrl('nad.example.com')).toBeNull();
    expect(parseCanonicalUrl(`https://${'a'.repeat(300)}.example.com`)).toBeNull();
  });
});

describe('getRequestOrigin', () => {
  it('prefers the leftmost forwarded host and proto', () => {
    const headers = new Headers({
      host: 'internal:3000',
      'x-forwarded-host': 'nad.example.com, proxy.internal',
      'x-forwarded-proto': 'https, http',
    });
    expect(getRequestOrigin(headers)).toBe('https://nad.example.com');
  });

  it('falls back to the host header with an assumed HTTP scheme', () => {
    expect(getRequestOrigin(new Headers({ host: '192.168.1.15:3000' })))
      .toBe('http://192.168.1.15:3000');
  });

  it('returns undefined for missing hosts, invalid protocols, and credential hosts', () => {
    expect(getRequestOrigin(new Headers())).toBeUndefined();
    expect(getRequestOrigin(new Headers({ host: 'nad.example.com', 'x-forwarded-proto': 'gopher' })))
      .toBeUndefined();
    expect(getRequestOrigin(new Headers({ host: 'user:pw@nad.example.com' }))).toBeUndefined();
  });
});

describe('originsMatch', () => {
  it('matches equivalent origins across case and default ports', () => {
    expect(originsMatch('https://NAD.example.com', 'https://nad.example.com:443')).toBe(true);
    expect(originsMatch('http://192.168.1.15:3000', 'http://192.168.1.15:3000')).toBe(true);
  });

  it('rejects different hosts, ports, or protocols', () => {
    expect(originsMatch('https://nad.example.com', 'https://other.example.com')).toBe(false);
    expect(originsMatch('http://192.168.1.15:3000', 'http://192.168.1.15:3001')).toBe(false);
    expect(originsMatch('http://nad.example.com', 'https://nad.example.com')).toBe(false);
  });

  it('fails closed on unparseable input', () => {
    expect(originsMatch('not a url', 'https://nad.example.com')).toBe(false);
  });
});
