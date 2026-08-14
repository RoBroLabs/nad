/**
 * Public trust roots shipped with this NAD core release. Private release keys
 * are kept offline and never committed to any repository or dashboard image.
 */
export const builtInModuleTrustRoots: Readonly<Record<string, string>> = {
  'robrolabs-first-party-2026-01': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAfi0Fv9yY/iu5fzIi7z0JsN87MvFCMEZEfra2NsrUYvY=
-----END PUBLIC KEY-----`,
  'robrolabs-first-party-2026-08': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAOUmSvPr7MhzZ0eyR52rbioqt9zfxJIAyXUoYm/QyMTs=
-----END PUBLIC KEY-----`,
};
