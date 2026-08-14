import type { ModuleEndpointSchemaDocument } from '@/lib/modules/contracts/v1';
import { validateContractDocument } from '@/lib/modules/contracts/validators';
import { ModulePackageError } from '@/lib/modules/installed/package-types';

const MAX_SCHEMA_DEPTH = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function matchesType(value: unknown, type: string): boolean {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isRecord(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertSchemaShape(schema: unknown, depth = 0): asserts schema is ModuleEndpointSchemaDocument {
  const result = validateContractDocument('endpoint-schema.v1.schema.json', schema);
  if (!result.valid) {
    throw new ModulePackageError(result.error ?? 'Endpoint schema is invalid.', 'INVALID_PACKAGE');
  }
  if (depth > MAX_SCHEMA_DEPTH || !isRecord(schema)) {
    throw new ModulePackageError('Endpoint schema exceeds the supported depth.', 'INVALID_PACKAGE');
  }
  if (typeof schema.pattern === 'string') {
    try {
      void new RegExp(schema.pattern, 'u');
    } catch {
      throw new ModulePackageError('Endpoint schema pattern is invalid.', 'INVALID_PACKAGE');
    }
  }
  if (schema.items !== undefined) assertSchemaShape(schema.items, depth + 1);
  if (schema.properties) {
    for (const nested of Object.values(schema.properties)) {
      assertSchemaShape(nested, depth + 1);
    }
  }
}

function validate(value: unknown, schemaValue: ModuleEndpointSchemaDocument, path: string, depth: number): string | undefined {
  if (depth > MAX_SCHEMA_DEPTH) return `${path} exceeds the supported schema depth.`;
  if (schemaValue.const !== undefined && !Object.is(schemaValue.const, value)) {
    return `${path} does not match the required constant.`;
  }
  if (Array.isArray(schemaValue.enum) && !schemaValue.enum.some((candidate) => Object.is(candidate, value))) {
    return `${path} is not one of the allowed values.`;
  }
  const declaredTypes = Array.isArray(schemaValue.type)
    ? schemaValue.type
    : schemaValue.type ? [schemaValue.type] : [];
  if (declaredTypes.length && !declaredTypes.some((type) => matchesType(value, type))) {
    return `${path} has the wrong type.`;
  }
  if (typeof value === 'number') {
    if (typeof schemaValue.minimum === 'number' && value < schemaValue.minimum) return `${path} is below its minimum.`;
    if (typeof schemaValue.maximum === 'number' && value > schemaValue.maximum) return `${path} is above its maximum.`;
  }
  if (typeof value === 'string') {
    if (typeof schemaValue.maxLength === 'number' && value.length > schemaValue.maxLength) return `${path} is too long.`;
    if (typeof schemaValue.minLength === 'number' && value.length < schemaValue.minLength) return `${path} is too short.`;
    if (typeof schemaValue.pattern === 'string' && !(new RegExp(schemaValue.pattern, 'u')).test(value)) {
      return `${path} does not match the required pattern.`;
    }
  }
  if (Array.isArray(value)) {
    if (typeof schemaValue.minItems === 'number' && value.length < schemaValue.minItems) return `${path} has too few items.`;
    if (typeof schemaValue.maxItems === 'number' && value.length > schemaValue.maxItems) return `${path} has too many items.`;
    if (schemaValue.uniqueItems) {
      const seen = new Set<string>();
      for (const entry of value) {
        const marker = stableStringify(entry);
        if (seen.has(marker)) return `${path} has duplicate items.`;
        seen.add(marker);
      }
    }
    if (schemaValue.items !== undefined) {
      for (let index = 0; index < value.length; index += 1) {
        const issue = validate(value[index], schemaValue.items, `${path}[${index}]`, depth + 1);
        if (issue) return issue;
      }
    }
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (typeof schemaValue.minProperties === 'number' && keys.length < schemaValue.minProperties) {
      return `${path} has too few properties.`;
    }
    if (typeof schemaValue.maxProperties === 'number' && keys.length > schemaValue.maxProperties) {
      return `${path} has too many properties.`;
    }
    const required = Array.isArray(schemaValue.required) ? schemaValue.required : [];
    for (const key of required) {
      if (!(key in value)) return `${path}.${key} is required.`;
    }
    const properties = schemaValue.properties ?? {};
    if (schemaValue.additionalProperties === false) {
      const unexpected = keys.find((key) => !(key in properties));
      if (unexpected) return `${path}.${unexpected} is not allowed.`;
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!(key in value)) continue;
      const issue = validate(value[key], propertySchema, `${path}.${key}`, depth + 1);
      if (issue) return issue;
    }
  }
  return undefined;
}

export function assertEndpointSchemaDocument(schema: unknown): asserts schema is ModuleEndpointSchemaDocument {
  assertSchemaShape(schema, 0);
}

export function assertJsonSchema(value: unknown, schema: unknown, label: string): void {
  assertEndpointSchemaDocument(schema);
  const issue = validate(value, schema, label, 0);
  if (issue) throw new ModulePackageError(issue, 'SCHEMA_VALIDATION_FAILED');
}
