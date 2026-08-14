import { getRequestOrigin, originsMatch } from '@/lib/access-url';

const MAX_JSON_BODY_BYTES = 64 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestBodyTooLargeError';
  }
}

export function isSameOriginMutationRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const requestOrigin = getRequestOrigin(request.headers) ?? new URL(request.url).origin;
  return originsMatch(origin, requestOrigin);
}

export function hasJsonContentType(request: Request): boolean {
  return request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

export async function readBodyBytes(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  tooLargeMessage = 'Request body is too large.',
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel(tooLargeMessage);
        throw new RequestBodyTooLargeError(tooLargeMessage);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  if (!hasJsonContentType(request)) return null;
  const contentLengthHeader = request.headers.get('content-length');
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (contentLength !== null && Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    return null;
  }

  try {
    const bytes = await readBodyBytes(request.body, MAX_JSON_BODY_BYTES);
    if (!bytes.length) return null;
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
