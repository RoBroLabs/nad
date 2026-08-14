interface ApiEnvelope {
  data?: unknown;
  error?: unknown;
}

function isEnvelope(value: unknown): value is ApiEnvelope {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function requestApi<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  fallbackMessage = 'The request could not be completed.',
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Error('NAD could not be reached. Check your connection and try again.');
  }

  let envelope: ApiEnvelope | null = null;
  try {
    const payload = await response.json() as unknown;
    envelope = isEnvelope(payload) ? payload : null;
  } catch {
    // The status-specific fallback below is safer than exposing an HTML response.
  }

  if (!response.ok) {
    throw new Error(
      envelope && typeof envelope.error === 'string'
        ? envelope.error
        : fallbackMessage,
    );
  }
  if (!envelope || !Object.hasOwn(envelope, 'data')) {
    throw new Error(fallbackMessage);
  }
  return envelope.data as T;
}
