import type { NextConfig } from 'next';
import { NAD_CORE_VERSION } from './src/lib/runtime/build-info';

function grafanaFrameSource(): string | null {
  const value = process.env.GRAFANA_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',
  poweredByHeader: false,

  // Canonical contracts are generated as standards-compliant ESM TypeScript
  // shared with the SDK. Resolve their emitted `.js` specifiers back to source
  // `.ts` files while compiling NAD itself.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },

  env: {
    NAD_VERSION: NAD_CORE_VERSION,
  },

  // Allow Grafana iframe embeds
  async headers() {
    const frameSource = grafanaFrameSource();
    const scriptSources = ["'self'", "'unsafe-inline'"];
    if (process.env.NODE_ENV !== 'production') scriptSources.push("'unsafe-eval'");
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `script-src ${scriptSources.join(' ')}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              `frame-src 'self' blob:${frameSource ? ` ${frameSource}` : ''}`,
              "connect-src 'self'",
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
