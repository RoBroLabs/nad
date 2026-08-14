import 'server-only';

import type { ModuleManifest } from '@/lib/modules/types';

export interface ModuleConfigValidation {
  valid: boolean;
  error?: string;
}

/**
 * Core validates the portable field contract. Module-specific request and
 * response semantics live in the signed package schemas and isolated runtime,
 * never in slug-specific core imports.
 */
export function validateModuleConfig(
  manifest: ModuleManifest,
  config: Record<string, string>,
): ModuleConfigValidation {
  const missingField = manifest.configSchema.find(
    (field) => field.required && !config[field.key]?.trim(),
  );
  if (missingField) return { valid: false, error: `${missingField.label} is required.` };

  for (const field of manifest.configSchema) {
    const value = config[field.key];
    if (!value) continue;
    if (field.type === 'number') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return { valid: false, error: `${field.label} must be a number.` };
      if (field.min !== undefined && parsed < field.min) return { valid: false, error: `${field.label} is below its minimum.` };
      if (field.max !== undefined && parsed > field.max) return { valid: false, error: `${field.label} is above its maximum.` };
    }
    if (field.type === 'url') {
      try {
        const url = new URL(value);
        if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) throw new Error('invalid');
      } catch {
        return { valid: false, error: `${field.label} must be a normal HTTP(S) URL without embedded credentials.` };
      }
    }
    if (field.type === 'select' && !field.options?.some(({ value: option }) => option === value)) {
      return { valid: false, error: `${field.label} uses an unsupported option.` };
    }
  }
  return { valid: true };
}
