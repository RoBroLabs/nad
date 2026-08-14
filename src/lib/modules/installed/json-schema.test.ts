import { describe, expect, it } from 'vitest';
import { assertEndpointSchemaDocument, assertJsonSchema } from '@/lib/modules/installed/json-schema';

describe('assertJsonSchema', () => {
  it('enforces the canonical bounded endpoint-schema dialect', () => {
    const schema = {
      type: 'object',
      minProperties: 1,
      maxProperties: 2,
      required: ['status', 'labels'],
      additionalProperties: false,
      properties: {
        status: { const: 'ok' },
        labels: {
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: { type: 'string', pattern: '^[a-z]+$' },
        },
      },
    };

    expect(() => assertEndpointSchemaDocument(schema)).not.toThrow();
    expect(() => assertJsonSchema({ status: 'ok', labels: ['alpha'] }, schema, 'response')).not.toThrow();
    expect(() => assertJsonSchema({ status: 'bad', labels: ['alpha'] }, schema, 'response')).toThrow('required constant');
    expect(() => assertJsonSchema({ status: 'ok', labels: [] }, schema, 'response')).toThrow('too few items');
    expect(() => assertJsonSchema({ status: 'ok', labels: ['alpha', 'alpha'] }, schema, 'response')).toThrow('duplicate items');
    expect(() => assertJsonSchema({ status: 'ok', labels: ['alpha', 'UPPER'] }, schema, 'response')).toThrow('required pattern');
    expect(() => assertJsonSchema({ status: 'ok', labels: ['alpha'], extra: true }, schema, 'response')).toThrow('too many properties');
  });

  it('rejects invalid endpoint-schema documents before data validation', () => {
    expect(() => assertEndpointSchemaDocument({ type: 'bogus' })).toThrow('allowed values');
    expect(() => assertEndpointSchemaDocument({ type: 'string', pattern: '[' })).toThrow('pattern is invalid');
  });
});
