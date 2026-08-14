function configuredProtocol(configuredUrl: string | undefined): string | undefined {
  if (!configuredUrl) return undefined;

  try {
    return new URL(configuredUrl).protocol;
  } catch {
    return undefined;
  }
}

export function shouldUseSecureSessionCookie(
  requestUrl: string,
  forwardedProto: string | null,
  configuredUrl = process.env.AUTH_URL ?? process.env.APP_URL,
): boolean {
  const appProtocol = configuredProtocol(configuredUrl);
  if (appProtocol) return appProtocol === 'https:';

  const proxyProtocol = forwardedProto
    ?.split(',', 1)[0]
    ?.trim()
    .toLowerCase();
  if (proxyProtocol) return proxyProtocol === 'https';

  try {
    return new URL(requestUrl).protocol === 'https:';
  } catch {
    return false;
  }
}
