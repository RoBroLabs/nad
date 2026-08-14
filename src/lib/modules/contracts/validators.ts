import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import { contractSchemas } from '@/lib/modules/contracts/v1/schemas.generated';
import { contractV2Schemas } from '@/lib/modules/contracts/v2/schemas.generated';

export type ContractSchemaName = keyof typeof contractSchemas;
export type ContractV2SchemaName = keyof typeof contractV2Schemas;

interface ContractValidationResult {
  valid: boolean;
  error?: string;
}

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  strictRequired: false,
});

for (const [name, schema] of Object.entries(contractSchemas) as Array<[ContractSchemaName, (typeof contractSchemas)[ContractSchemaName]]>) {
  ajv.addSchema(schema as object, name);
}

const validators = new Map<ContractSchemaName, ValidateFunction<unknown>>();
const validatorsV2 = new Map<ContractV2SchemaName, ValidateFunction<unknown>>();

const ajvV2 = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  strictRequired: false,
});
for (const [name, schema] of Object.entries(contractV2Schemas) as Array<[
  ContractV2SchemaName,
  (typeof contractV2Schemas)[ContractV2SchemaName],
]>) {
  ajvV2.addSchema(schema as object, name);
}

function validatorFor(name: ContractSchemaName): ValidateFunction<unknown> {
  const existing = validators.get(name);
  if (existing) return existing;
  const compiled = ajv.getSchema(name) ?? ajv.compile(contractSchemas[name] as object);
  validators.set(name, compiled);
  return compiled;
}

function formatError(errors: ErrorObject[] | null | undefined): string {
  const issue = errors?.[0];
  if (!issue) return 'Document does not match the canonical contract.';
  const path = issue.instancePath || issue.schemaPath || '/';
  const property = typeof issue.params === 'object' && issue.params && 'missingProperty' in issue.params
    ? String(issue.params.missingProperty)
    : '';
  if (property) return `${path}: missing required property ${property}.`;
  return `${path}: ${issue.message ?? 'Document does not match the canonical contract.'}`;
}

export function validateContractDocument(
  name: ContractSchemaName,
  value: unknown,
): ContractValidationResult {
  const validator = validatorFor(name);
  return validator(value)
    ? { valid: true }
    : { valid: false, error: formatError(validator.errors) };
}

export function validateContractV2Document(
  name: ContractV2SchemaName,
  value: unknown,
): ContractValidationResult {
  let validator = validatorsV2.get(name);
  if (!validator) {
    validator = ajvV2.getSchema(name) ?? ajvV2.compile(contractV2Schemas[name] as object);
    validatorsV2.set(name, validator);
  }
  return validator(value)
    ? { valid: true }
    : { valid: false, error: formatError(validator.errors) };
}
