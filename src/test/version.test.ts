import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contractLock } from '@/lib/modules/contracts/v1/schemas.generated';
import {
  NAD_CORE_VERSION,
  NAD_HOST_API_COMPATIBILITY,
  NAD_HOST_API_VERSION,
  NAD_MODULE_PACKAGE_SCHEMA_DISPLAY_VERSION,
  NAD_MODULE_PACKAGE_SCHEMA_VERSION,
  NAD_UI_API_COMPATIBILITY,
  NAD_UI_API_VERSION,
} from '@/lib/runtime/build-info';

describe('VERSION file', () => {
  it('exists at the repository root and holds a single safe display token', () => {
    // next.config.ts inlines this value as NAD_VERSION at build time, so it
    // must stay a single-line, URL/HTML-safe token.
    const version = readFileSync(join(process.cwd(), 'VERSION'), 'utf8').trim();
    expect(version).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/);
  });

  it('matches the central runtime build constants', () => {
    const version = readFileSync(join(process.cwd(), 'VERSION'), 'utf8').trim();
    expect(NAD_CORE_VERSION).toBe(version);
    expect(NAD_HOST_API_VERSION).toBe(contractLock.hostApiVersion);
    expect(NAD_HOST_API_COMPATIBILITY).toBe(contractLock.hostApiCompatibility);
    expect(NAD_UI_API_VERSION).toBe(contractLock.uiApiVersion);
    expect(NAD_UI_API_COMPATIBILITY).toBe(contractLock.uiApiCompatibility);
    expect(NAD_MODULE_PACKAGE_SCHEMA_VERSION).toBe(contractLock.packageSchemaVersion);
    expect(NAD_MODULE_PACKAGE_SCHEMA_DISPLAY_VERSION).toBe(contractLock.contractVersion);
  });
});
