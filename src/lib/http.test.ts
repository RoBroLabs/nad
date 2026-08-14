import { describe, expect, it } from 'vitest';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';

describe('isSameOriginMutationRequest', () => {
  it('requires an exact browser origin matching the forwarded request origin', () => {
    const matching = new Request('http://internal:3000/api/test', {
      method: 'POST',
      headers: {
        origin: 'https://nad.example.test',
        'x-forwarded-host': 'nad.example.test',
        'x-forwarded-proto': 'https',
      },
    });
    expect(isSameOriginMutationRequest(matching)).toBe(true);

    expect(isSameOriginMutationRequest(new Request('https://nad.example.test/api/test', {
      method: 'POST',
    }))).toBe(false);
    expect(isSameOriginMutationRequest(new Request('http://internal:3000/api/test', {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example',
        'x-forwarded-host': 'nad.example.test',
        'x-forwarded-proto': 'https',
      },
    }))).toBe(false);
  });
});

describe('readJsonObject', () => {
  it('parses a JSON object', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'ok' }),
    });

    await expect(readJsonObject(request)).resolves.toEqual({ value: 'ok' });
  });

  it('rejects non-object and malformed JSON bodies', async () => {
    const arrayRequest = new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    });
    const malformedRequest = new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    await expect(readJsonObject(arrayRequest)).resolves.toBeNull();
    await expect(readJsonObject(malformedRequest)).resolves.toBeNull();
  });

  it('rejects oversized bodies even without a content-length header', async () => {
    const encoder = new TextEncoder();
    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`{"value":"${'x'.repeat(70 * 1024)}"}`));
        controller.close();
      },
    });
    const request = new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: oversizedBody,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    await expect(readJsonObject(request)).resolves.toBeNull();
  });

  it('rejects JSON-shaped text/plain bodies', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ value: 'not-json-content-type' }),
    });

    await expect(readJsonObject(request)).resolves.toBeNull();
  });
});
