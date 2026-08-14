function getConfiguredAppUrl(): string | undefined {
  return process.env.AUTH_URL ?? process.env.APP_URL;
}

export function getCanonicalLoginUrl(setupComplete = false): string | undefined {
  const configuredUrl = getConfiguredAppUrl();
  if (!configuredUrl) return undefined;

  try {
    const url = new URL('/login', configuredUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    if (setupComplete) url.searchParams.set('setup', 'complete');
    return url.toString();
  } catch {
    return undefined;
  }
}
