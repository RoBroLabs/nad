import type {
  ModuleChecksumsDocument,
  ModuleManifestDocument,
  ModulePagesDocument,
  ModuleSignatureDocument,
  ModuleUiElementDocument,
  ModuleWidgetsDocument,
} from '@/lib/modules/contracts/v1';
import { contractLock } from '@/lib/modules/contracts/v1';
import { contractV2Lock } from '@/lib/modules/contracts/v2';
import type {
  NADV2AppOrAddOnManifest,
  NADV2ConnectionProfileSchema,
  NADUIAPIV2Surfaces,
} from '@/lib/modules/contracts/v2';
import { validateContractDocument, validateContractV2Document } from '@/lib/modules/contracts/validators';
import type {
  ConfigField,
  GridSize,
  InstalledDataView,
  InstalledPageView,
  InstalledWidgetView,
  InstalledUiElement,
  ModuleCapability,
  ModuleCategory,
  ModuleEntrypoint,
  ModuleHttpAccessScope,
  PermissionDefinition,
  UserRole,
} from '@/lib/modules/types';
import {
  ModulePackageError,
  type InstalledPackageManifestSource,
  type InstalledAnyPackageManifest,
  type InstalledPackageManifestV2,
  type InstalledPageDocument,
  type InstalledWidgetDocument,
  type PackageChecksums,
  type PackageSignature,
} from '@/lib/modules/installed/package-types';

const categories = new Set<ModuleCategory>([
  'servers', 'media', 'games', 'network', 'tools', 'automation', 'monitoring', 'custom',
]);
const configTypes = new Set(['text', 'url', 'secret', 'number', 'boolean', 'select']);
const dataViewTypes = new Set(['metrics', 'status-list', 'key-value', 'table', 'json']);
const allowedCapabilities = new Set(contractLock.capabilities);
const allowedV2Capabilities = new Set(contractV2Lock.capabilities);
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const permissionActionPattern = /^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+)*$/;
const relativePathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9._/-]+$/;
const packageControlledForbiddenHeaders = new Set([
  'authorization', 'connection', 'content-length', 'cookie', 'expect', 'forwarded',
  'host', 'proxy-authenticate', 'proxy-authorization', 'set-cookie', 'trailer',
  'transfer-encoding', 'upgrade', 'via', 'x-forwarded-for', 'x-forwarded-host',
  'x-forwarded-proto', 'x-real-ip',
]);
const injectedForbiddenHeaders = new Set([
  'connection', 'content-length', 'cookie', 'expect', 'forwarded', 'host',
  'proxy-authenticate', 'proxy-authorization', 'set-cookie', 'trailer',
  'transfer-encoding', 'upgrade', 'via', 'x-forwarded-for', 'x-forwarded-host',
  'x-forwarded-proto', 'x-real-ip',
]);

function fail(message: string): never {
  throw new ModulePackageError(message, 'INVALID_PACKAGE');
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, max = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    fail(`${label} must be a non-empty string no longer than ${max} characters.`);
  }
  return value;
}

function optionalString(value: unknown, label: string, max = 512): string | undefined {
  return value === undefined ? undefined : string(value, label, max);
}

function number(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || typeof value !== 'number' || value < minimum || value > maximum) {
    fail(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function array(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} must be an array with at most ${maximum} entries.`);
  return value;
}

function safeRelativePath(value: unknown, label: string): string {
  const path = string(value, label, 240);
  if (!relativePathPattern.test(path) || path.includes('\\')) fail(`${label} must be a safe relative path.`);
  return path;
}

function riskToDefaultRole(action: string, risk: 'read' | 'write' | 'admin'): UserRole {
  if (action === 'view' || risk === 'read') return 'member';
  return 'admin';
}

function validateCanonicalDocument(
  schemaName: Parameters<typeof validateContractDocument>[0],
  value: unknown,
  label: string,
): void {
  const result = validateContractDocument(schemaName, value);
  if (!result.valid) fail(`${label} does not match the canonical contract. ${result.error ?? ''}`.trim());
}

function isLegacyManifestDocument(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.permissions && Array.isArray(item.permissions)) {
    return item.permissions.some((entry) => Boolean(entry) && typeof entry === 'object' && 'defaultRole' in (entry as Record<string, unknown>));
  }
  return false;
}

function isLegacyPageDocument(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const pages = (value as Record<string, unknown>).pages;
  return Array.isArray(pages)
    && pages.some((entry) => Boolean(entry) && typeof entry === 'object' && 'view' in (entry as Record<string, unknown>));
}

function isLegacyWidgetDocument(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const widgets = (value as Record<string, unknown>).widgets;
  return Array.isArray(widgets)
    && widgets.some((entry) => Boolean(entry) && typeof entry === 'object' && 'view' in (entry as Record<string, unknown>));
}

function gridSize(value: unknown, label: string): GridSize {
  const item = record(value, label);
  return {
    w: number(item.w, `${label}.w`, 1, 12),
    h: number(item.h, `${label}.h`, 1, 24),
  };
}

function parseCapabilities(entries: ModuleManifestDocument['capabilities']): ModuleCapability[] {
  const seen = new Set<string>();
  return entries.map((entry, index) => {
    if (!allowedCapabilities.has(entry.name)) fail(`Unsupported Module capability: ${entry.name}.`);
    if (seen.has(entry.name)) fail(`Duplicate Module capability: ${entry.name}.`);
    seen.add(entry.name);
    return {
      name: entry.name,
      reason: string(entry.reason, `manifest.capabilities[${index}].reason`, 300),
    };
  });
}

function parsePermissions(
  permissions: ModuleManifestDocument['permissions'],
): PermissionDefinition[] {
  const seen = new Set<string>();
  return permissions.map((entry, index) => {
    const action = string(entry.action, `manifest.permissions[${index}].action`, 80);
    if (!permissionActionPattern.test(action) || seen.has(action)) fail(`Invalid or duplicate permission action: ${action}.`);
    seen.add(action);
    return {
      action,
      label: string(entry.label, `manifest.permissions[${index}].label`, 100),
      description: string(entry.description ?? entry.label, `manifest.permissions[${index}].description`, 300),
      defaultRole: riskToDefaultRole(action, entry.risk),
    };
  });
}

function parseConfigSchema(entries: ModuleManifestDocument['configSchema']): ConfigField[] {
  const seen = new Set<string>();
  return entries.map((entry, index) => {
    const key = string(entry.key, `manifest.configSchema[${index}].key`, 80);
    if (!/^[a-z][a-z0-9_]*$/.test(key) || seen.has(key)) fail(`Invalid or duplicate config key: ${key}.`);
    seen.add(key);
    if (!configTypes.has(entry.type)) fail(`Unsupported config field type: ${entry.type}.`);
    const parsed: ConfigField = {
      key,
      label: string(entry.label, `manifest.configSchema[${index}].label`, 100),
      type: entry.type,
      required: entry.required,
      placeholder: optionalString(entry.placeholder, `manifest.configSchema[${index}].placeholder`, 200),
      description: optionalString(entry.description, `manifest.configSchema[${index}].description`, 400),
    };
    if (entry.defaultValue !== undefined) parsed.defaultValue = entry.defaultValue;
    if (entry.min !== undefined) parsed.min = number(entry.min, `${key}.min`, -1_000_000, 1_000_000);
    if (entry.max !== undefined) parsed.max = number(entry.max, `${key}.max`, -1_000_000, 1_000_000);
    if (entry.options !== undefined) {
      parsed.options = entry.options.map((option, optionIndex) => ({
        label: string(option.label, `${key}.options[${optionIndex}].label`, 100),
        value: string(option.value, `${key}.options[${optionIndex}].value`, 100),
      }));
    }
    return parsed;
  });
}

function parseHttpAccess(
  scopes: ModuleManifestDocument['httpAccess'],
  capabilities: ModuleCapability[],
  configSchema: ConfigField[],
): ModuleHttpAccessScope[] {
  const hasHttpCapability = capabilities.some(({ name }) => name === 'http.request');
  if (scopes === undefined) {
    if (hasHttpCapability) fail('http.request requires at least one manifest.httpAccess scope.');
    return [];
  }
  if (!hasHttpCapability) fail('manifest.httpAccess requires the http.request capability.');
  const normalized = scopes.map((entry, index) => {
    const label = `manifest.httpAccess[${index}]`;
    const hostField = configSchema.find(({ key }) => key === entry.hostConfig);
    if (!hostField || (hostField.type !== 'text' && hostField.type !== 'url')) {
      fail(`${label}.hostConfig must reference a text or URL config field.`);
    }
    const common = {
      scheme: entry.scheme,
      hostConfig: entry.hostConfig,
      path: entry.path,
      methods: [...entry.methods],
      ...(entry.effect === undefined ? {} : { effect: entry.effect }),
      ...(entry.requestBodyPolicy === undefined ? {} : { requestBodyPolicy: entry.requestBodyPolicy }),
      ...(entry.allowedHeaders === undefined ? {} : { allowedHeaders: [...entry.allowedHeaders] }),
      ...(entry.queryParameters === undefined ? {} : { queryParameters: [...entry.queryParameters] }),
      ...(entry.pathParameters === undefined ? {} : { pathParameters: { ...entry.pathParameters } }),
      ...(entry.credential === undefined ? {} : { credential: { ...entry.credential } }),
      ...(entry.tlsVerifyConfig === undefined ? {} : { tlsVerifyConfig: entry.tlsVerifyConfig }),
    };
    if (entry.credential) {
      const secretField = configSchema.find(({ key }) => key === entry.credential?.config);
      if (!secretField || secretField.type !== 'secret') fail(`${label}.credential.config must reference a secret config field.`);
      if (entry.credential.publicConfig) {
        const publicField = configSchema.find(({ key }) => key === entry.credential?.publicConfig);
        if (!publicField || publicField.type === 'secret' || publicField.type === 'boolean' || publicField.type === 'select') {
          fail(`${label}.credential.publicConfig must reference a text, URL, or number config field.`);
        }
      }
      if (
        entry.credential.location === 'header'
        && injectedForbiddenHeaders.has(entry.credential.name.toLowerCase())
      ) {
        fail(`${label}.credential.name is a broker-controlled or unsafe header.`);
      }
    }
    if (entry.allowedHeaders?.some((name) => packageControlledForbiddenHeaders.has(name.toLowerCase()))) {
      fail(`${label}.allowedHeaders contains a broker-controlled or unsafe header.`);
    }
    if (entry.tlsVerifyConfig) {
      const tlsField = configSchema.find(({ key }) => key === entry.tlsVerifyConfig);
      if (!tlsField || tlsField.type !== 'boolean') fail(`${label}.tlsVerifyConfig must reference a boolean config field.`);
    }
    if ('portConfig' in entry) {
      const portField = configSchema.find(({ key }) => key === entry.portConfig);
      if (!portField || portField.type !== 'number') fail(`${label}.portConfig must reference a number config field.`);
      return {
        ...common,
        portConfig: entry.portConfig,
      } satisfies ModuleHttpAccessScope;
    }
    if (!('port' in entry)) return common satisfies ModuleHttpAccessScope;
    return {
      ...common,
      port: entry.port,
    } satisfies ModuleHttpAccessScope;
  });
  const identities = normalized.map((scope) => JSON.stringify({ ...scope, methods: [...scope.methods].sort() }));
  if (new Set(identities).size !== identities.length) fail('manifest.httpAccess contains a duplicate scope.');
  return normalized;
}

function parseEntrypoints(
  entrypoints: ModuleManifestDocument['entrypoints'],
  permissions: Set<string>,
): Record<string, ModuleEntrypoint> {
  const entries = Object.entries(entrypoints);
  if (entries.length === 0 || entries.length > 64) fail('manifest.entrypoints must contain between 1 and 64 endpoints.');
  return Object.fromEntries(entries.map(([path, entry]) => {
    if (!relativePathPattern.test(path) || path.length > 160) fail(`Invalid endpoint path: ${path}.`);
    if (!permissions.has(entry.permission)) fail(`Endpoint ${path} references undeclared permission ${entry.permission}.`);
    const result: ModuleEntrypoint = {
      method: entry.method,
      kind: entry.kind,
      permission: entry.permission,
      handler: string(entry.handler, `${path}.handler`, 100),
      requestSchema: safeRelativePath(entry.requestSchema, `${path}.requestSchema`),
      responseSchema: safeRelativePath(entry.responseSchema, `${path}.responseSchema`),
      timeoutClass: entry.timeoutClass,
      maxRequestBytes: number(entry.maxRequestBytes, `${path}.maxRequestBytes`, 0, 65_536),
      maxResponseBytes: number(entry.maxResponseBytes, `${path}.maxResponseBytes`, 1, 1_048_576),
    };
    if (entry.kind === 'mutation') result.auditAction = string(entry.auditAction, `${path}.auditAction`, 80);
    return [path, result];
  }));
}

function normalizeCanonicalManifest(value: ModuleManifestDocument): InstalledPackageManifestSource {
  const id = string(value.id, 'manifest.id', 160);
  const slug = string(value.slug, 'manifest.slug', 80);
  const version = string(value.version, 'manifest.version', 80);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id)) fail('manifest.id must be a reverse-domain identifier.');
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) fail('manifest.slug must be kebab-case.');
  if (!semverPattern.test(version)) fail('manifest.version must be SemVer.');
  const category = string(value.category, 'manifest.category', 30) as ModuleCategory;
  if (!categories.has(category)) fail(`Unsupported Module category: ${category}.`);
  const permissions = parsePermissions(value.permissions);
  if (!permissions.some(({ action }) => action === 'view')) fail('Every Module must declare a view permission.');
  const capabilities = parseCapabilities(value.capabilities);
  const configSchema = parseConfigSchema(value.configSchema);
  const httpAccess = parseHttpAccess(value.httpAccess, capabilities, configSchema);
  return {
    schemaVersion: 1,
    id,
    slug,
    name: string(value.name, 'manifest.name', 100),
    description: string(value.description, 'manifest.description', 500),
    icon: string(value.icon, 'manifest.icon', 80),
    category,
    version,
    publisher: string(value.publisher, 'manifest.publisher', 120),
    compatibility: {
      core: string(value.compatibility.core, 'manifest.compatibility.core', 80),
      hostApi: string(value.compatibility.hostApi, 'manifest.compatibility.hostApi', 20),
      uiApi: string(value.compatibility.uiApi, 'manifest.compatibility.uiApi', 20),
    },
    capabilities,
    ...(httpAccess.length ? { httpAccess } : {}),
    permissions,
    configSchema,
    ...(value.dataMigrations ? { dataMigrations: value.dataMigrations } : {}),
    entrypoints: parseEntrypoints(value.entrypoints, new Set(permissions.map(({ action }) => action))),
  };
}

function parseLegacyPermissions(value: unknown): PermissionDefinition[] {
  const seen = new Set<string>();
  const permissions = array(value, 'manifest.permissions', 32).map((entry, index) => {
    const item = record(entry, `manifest.permissions[${index}]`);
    const action = string(item.action, `manifest.permissions[${index}].action`, 80);
    if (!permissionActionPattern.test(action) || seen.has(action)) fail(`Invalid or duplicate permission action: ${action}.`);
    seen.add(action);
    const defaultRole = (item.defaultRole ?? (action === 'view' ? 'member' : 'admin')) as UserRole;
    if (defaultRole !== 'admin' && defaultRole !== 'member' && defaultRole !== 'restricted') {
      fail(`Invalid default role for ${action}.`);
    }
    return {
      action,
      label: string(item.label, `manifest.permissions[${index}].label`, 100),
      description: string(item.description ?? item.label, `manifest.permissions[${index}].description`, 300),
      defaultRole,
    };
  });
  if (!permissions.some(({ action }) => action === 'view')) fail('Every Module must declare a view permission.');
  return permissions;
}

function parseLegacyManifest(value: unknown): InstalledPackageManifestSource {
  const item = record(value, 'manifest');
  if (item.schemaVersion !== 1) fail('Only Module package schemaVersion 1 is supported.');
  const id = string(item.id, 'manifest.id', 160);
  const slug = string(item.slug, 'manifest.slug', 80);
  const version = string(item.version, 'manifest.version', 80);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id)) fail('manifest.id must be a reverse-domain identifier.');
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) fail('manifest.slug must be kebab-case.');
  if (!semverPattern.test(version)) fail('manifest.version must be SemVer.');
  const category = string(item.category ?? 'custom', 'manifest.category', 30) as ModuleCategory;
  if (!categories.has(category)) fail(`Unsupported Module category: ${category}.`);
  const permissions = parseLegacyPermissions(item.permissions);
  const capabilities = parseCapabilities(array(item.capabilities ?? [], 'manifest.capabilities', 16) as ModuleManifestDocument['capabilities']);
  const configSchema = parseConfigSchema(array(item.configSchema ?? [], 'manifest.configSchema', 64) as ModuleManifestDocument['configSchema']);
  const httpAccess = parseHttpAccess(item.httpAccess as ModuleManifestDocument['httpAccess'], capabilities, configSchema);
  return {
    schemaVersion: 1,
    id,
    slug,
    name: string(item.name, 'manifest.name', 100),
    description: string(item.description, 'manifest.description', 500),
    icon: string(item.icon, 'manifest.icon', 80),
    category,
    version,
    publisher: string(item.publisher, 'manifest.publisher', 120),
    compatibility: {
      core: string(record(item.compatibility, 'manifest.compatibility').core, 'manifest.compatibility.core', 80),
      hostApi: string(record(item.compatibility, 'manifest.compatibility').hostApi, 'manifest.compatibility.hostApi', 20),
      uiApi: string(record(item.compatibility, 'manifest.compatibility').uiApi, 'manifest.compatibility.uiApi', 20),
    },
    capabilities,
    ...(httpAccess.length ? { httpAccess } : {}),
    permissions,
    configSchema,
    entrypoints: parseEntrypoints(record(item.entrypoints, 'manifest.entrypoints') as ModuleManifestDocument['entrypoints'], new Set(permissions.map(({ action }) => action))),
  };
}

function inferViewType(body: InstalledUiElement[]): InstalledDataView['type'] {
  const flattened = body.flatMap((element) => element.type === 'section' ? element.body : [element]);
  if (flattened.some(({ type }) => type === 'table')) return 'table';
  if (flattened.some(({ type }) => type === 'metric' || type === 'status')) return 'metrics';
  if (flattened.some(({ type }) => type === 'keyValue')) return 'key-value';
  return 'json';
}

function normalizeUiElements(
  elements: ModuleUiElementDocument[],
  label: string,
  depth = 0,
): InstalledUiElement[] {
  if (depth > 5) fail(`${label} is nested too deeply.`);
  return elements.map((element, index) => {
    const current = `${label}[${index}]`;
    if (element.type === 'section') {
      return {
        type: 'section',
        title: optionalString(element.title, `${current}.title`, 100),
        body: normalizeUiElements(element.body, `${current}.body`, depth + 1),
      };
    }
    if (element.type === 'metric' || element.type === 'status') {
      return {
        type: element.type,
        label: string(element.label, `${current}.label`, 100),
        valuePath: string(element.valuePath, `${current}.valuePath`, 160),
        ...(element.unit === undefined ? {} : { unit: string(element.unit, `${current}.unit`, 30) }),
        ...(element.tonePath === undefined ? {} : { tonePath: string(element.tonePath, `${current}.tonePath`, 160) }),
      } satisfies InstalledUiElement;
    }
    if (element.type === 'text') {
      if (element.value === undefined && element.valuePath === undefined) fail(`${current} text requires value or valuePath.`);
      return {
        type: 'text',
        value: optionalString(element.value, `${current}.value`, 500),
        valuePath: optionalString(element.valuePath, `${current}.valuePath`, 160),
      };
    }
    if (element.type === 'keyValue') {
      return {
        type: 'keyValue',
        items: element.items.map((item, itemIndex) => ({
          label: string(item.label, `${current}.items[${itemIndex}].label`, 100),
          valuePath: string(item.valuePath, `${current}.items[${itemIndex}].valuePath`, 160),
          unit: optionalString(item.unit, `${current}.items[${itemIndex}].unit`, 30),
        })),
      };
    }
    if (element.type !== 'table') fail(`Unsupported declarative UI element: ${JSON.stringify(element)}.`);
    const tableElement = element;
    return {
      type: 'table',
      rowsPath: string(tableElement.rowsPath, `${current}.rowsPath`, 160),
      columns: tableElement.columns.map((column, columnIndex) => ({
        key: string(column.key, `${current}.columns[${columnIndex}].key`, 80),
        label: string(column.label, `${current}.columns[${columnIndex}].label`, 100),
        valuePath: string(column.valuePath, `${current}.columns[${columnIndex}].valuePath`, 160),
      })),
      emptyText: optionalString(tableElement.emptyText, `${current}.emptyText`, 200),
    };
  });
}

function normalizeCanonicalWidgetDocument(value: ModuleWidgetsDocument): InstalledWidgetDocument {
  const seen = new Set<string>();
  return {
    schemaVersion: 1,
    widgets: value.widgets.map((widget, index) => {
      const id = string(widget.id, `widgets[${index}].id`, 80);
      if (!/^[a-z][a-z0-9-]*$/.test(id) || seen.has(id)) fail(`Invalid or duplicate Widget id: ${id}.`);
      seen.add(id);
      const body = normalizeUiElements(widget.body, `widgets[${index}].body`);
      const source = widget.source;
      return {
        id,
        name: string(widget.name, `widgets[${index}].name`, 100),
        description: string(widget.description, `widgets[${index}].description`, 300),
        defaultSize: gridSize(widget.defaultSize, `widgets[${index}].defaultSize`),
        ...(widget.minSize ? { minSize: gridSize(widget.minSize, `widgets[${index}].minSize`) } : {}),
        ...(widget.maxSize ? { maxSize: gridSize(widget.maxSize, `widgets[${index}].maxSize`) } : {}),
        ...(widget.requiredConfig ? { requiredConfig: [...widget.requiredConfig] } : {}),
        view: {
          endpoint: safeRelativePath(source.endpoint, `widgets[${index}].source.endpoint`),
          ...(source.refreshIntervalMs === undefined ? {} : { refreshInterval: number(source.refreshIntervalMs, `widgets[${index}].source.refreshIntervalMs`, 1_000, 3_600_000) }),
          type: inferViewType(body),
          body,
        } satisfies InstalledWidgetView,
      };
    }),
  };
}

function normalizeCanonicalPageDocument(value: ModulePagesDocument): InstalledPageDocument {
  return {
    schemaVersion: 1,
    pages: value.pages.map((page, index) => {
      const body = normalizeUiElements(page.body, `pages[${index}].body`);
      return {
        path: page.path,
        title: string(page.title, `pages[${index}].title`, 100),
        icon: optionalString(page.icon, `pages[${index}].icon`, 80),
        view: {
          sections: [{
            id: 'module-content',
            title: string(page.title, `pages[${index}].title`, 100),
            endpoint: safeRelativePath(page.source?.endpoint, `pages[${index}].source.endpoint`),
            ...(page.source?.refreshIntervalMs === undefined
              ? {}
              : { refreshInterval: number(page.source.refreshIntervalMs, `pages[${index}].source.refreshIntervalMs`, 1_000, 3_600_000) }),
            type: inferViewType(body),
            body,
          }],
        } satisfies InstalledPageView,
      };
    }),
  };
}

function parseDataView(value: unknown, label: string): InstalledDataView {
  const item = record(value, label);
  const type = string(item.type, `${label}.type`, 30);
  if (!dataViewTypes.has(type)) fail(`Unsupported data view type: ${type}.`);
  return {
    type: type as InstalledDataView['type'],
    endpoint: safeRelativePath(item.endpoint, `${label}.endpoint`),
    emptyMessage: optionalString(item.emptyMessage, `${label}.emptyMessage`, 200),
    refreshInterval: item.refreshInterval === undefined
      ? undefined
      : number(item.refreshInterval, `${label}.refreshInterval`, 1_000, 3_600_000),
  };
}

function parseLegacyUiElements(value: unknown, label: string, depth = 0): InstalledUiElement[] {
  if (depth > 5) fail(`${label} is nested too deeply.`);
  return array(value, label, 64).map((entry, index) => {
    const item = record(entry, `${label}[${index}]`);
    const type = string(item.type, `${label}[${index}].type`, 30);
    if (type === 'section') {
      return {
        type,
        title: optionalString(item.title, `${label}[${index}].title`, 100),
        body: parseLegacyUiElements(item.body, `${label}[${index}].body`, depth + 1),
      };
    }
    if (type === 'metric' || type === 'status') {
      return {
        type,
        label: string(item.label, `${label}[${index}].label`, 100),
        valuePath: string(item.valuePath, `${label}[${index}].valuePath`, 160),
        ...(item.unit === undefined ? {} : { unit: string(item.unit, `${label}[${index}].unit`, 30) }),
        ...(item.tonePath === undefined ? {} : { tonePath: string(item.tonePath, `${label}[${index}].tonePath`, 160) }),
      } satisfies InstalledUiElement;
    }
    if (type === 'text') {
      if (item.value === undefined && item.valuePath === undefined) fail(`${label}[${index}] text requires value or valuePath.`);
      return {
        type,
        value: optionalString(item.value, `${label}[${index}].value`, 500),
        valuePath: optionalString(item.valuePath, `${label}[${index}].valuePath`, 160),
      };
    }
    if (type === 'keyValue') {
      return {
        type,
        items: array(item.items, `${label}[${index}].items`, 32).map((entryItem, itemIndex) => {
          const keyValue = record(entryItem, `${label}[${index}].items[${itemIndex}]`);
          return {
            label: string(keyValue.label, `${label}[${index}].items[${itemIndex}].label`, 100),
            valuePath: string(keyValue.valuePath, `${label}[${index}].items[${itemIndex}].valuePath`, 160),
            unit: optionalString(keyValue.unit, `${label}[${index}].items[${itemIndex}].unit`, 30),
          };
        }),
      };
    }
    if (type !== 'table') fail(`Unsupported declarative UI element: ${type}.`);
    return {
      type,
      rowsPath: string(item.rowsPath, `${label}[${index}].rowsPath`, 160),
      columns: array(item.columns, `${label}[${index}].columns`, 16).map((entryColumn, columnIndex) => {
        const column = record(entryColumn, `${label}[${index}].columns[${columnIndex}]`);
        return {
          key: string(column.key, `${label}[${index}].columns[${columnIndex}].key`, 80),
          label: string(column.label, `${label}[${index}].columns[${columnIndex}].label`, 100),
          valuePath: string(column.valuePath, `${label}[${index}].columns[${columnIndex}].valuePath`, 160),
        };
      }),
      emptyText: optionalString(item.emptyText, `${label}[${index}].emptyText`, 200),
    };
  });
}

function parseLegacyWidgetDocument(value: unknown): InstalledWidgetDocument {
  const item = record(value, 'ui/widgets.json');
  if (item.schemaVersion !== 1) fail('Only Widget UI schemaVersion 1 is supported.');
  const seen = new Set<string>();
  return {
    schemaVersion: 1,
    widgets: array(item.widgets, 'ui/widgets.json.widgets', 32).map((entry, index) => {
      const widget = record(entry, `widgets[${index}]`);
      const id = string(widget.id, `widgets[${index}].id`, 80);
      if (!/^[a-z][a-z0-9-]*$/.test(id) || seen.has(id)) fail(`Invalid or duplicate Widget id: ${id}.`);
      seen.add(id);
      const parsed: InstalledWidgetDocument['widgets'][number] = {
        id,
        name: string(widget.name, `widgets[${index}].name`, 100),
        description: string(widget.description, `widgets[${index}].description`, 300),
        defaultSize: gridSize(widget.defaultSize, `widgets[${index}].defaultSize`),
        view: parseDataView(widget.view, `widgets[${index}].view`) as InstalledWidgetView,
      };
      if (widget.minSize !== undefined) parsed.minSize = gridSize(widget.minSize, `widgets[${index}].minSize`);
      if (widget.maxSize !== undefined) parsed.maxSize = gridSize(widget.maxSize, `widgets[${index}].maxSize`);
      if (widget.requiredConfig !== undefined) {
        parsed.requiredConfig = array(widget.requiredConfig, `widgets[${index}].requiredConfig`, 32)
          .map((key, keyIndex) => string(key, `widgets[${index}].requiredConfig[${keyIndex}]`, 80));
      }
      return parsed;
    }),
  };
}

function parseLegacyPageDocument(value: unknown): InstalledPageDocument {
  const item = record(value, 'ui/pages.json');
  if (item.schemaVersion !== 1) fail('Only Page UI schemaVersion 1 is supported.');
  return {
    schemaVersion: 1,
    pages: array(item.pages, 'ui/pages.json.pages', 16).map((entry, index) => {
      const page = record(entry, `pages[${index}]`);
      const path = string(page.path, `pages[${index}].path`, 120);
      if (path !== '/' && !/^\/[a-z][a-z0-9/-]*$/.test(path)) fail(`Invalid Page path: ${path}.`);
      const view = record(page.view, `pages[${index}].view`);
      return {
        path,
        title: string(page.title, `pages[${index}].title`, 100),
        icon: optionalString(page.icon, `pages[${index}].icon`, 80),
        view: {
          sections: array(view.sections, `pages[${index}].view.sections`, 32).map((entrySection, sectionIndex) => {
            const section = record(entrySection, `pages[${index}].sections[${sectionIndex}]`);
            return {
              id: string(section.id, `pages[${index}].sections[${sectionIndex}].id`, 80),
              title: string(section.title, `pages[${index}].sections[${sectionIndex}].title`, 100),
              description: optionalString(section.description, `pages[${index}].sections[${sectionIndex}].description`, 300),
              ...parseDataView(section, `pages[${index}].sections[${sectionIndex}]`),
              ...(section.body === undefined ? {} : { body: parseLegacyUiElements(section.body, `pages[${index}].sections[${sectionIndex}].body`) }),
            };
          }),
        },
      };
    }),
  };
}

export function parsePackageManifest(value: unknown): InstalledPackageManifestSource {
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).schemaVersion === 2) {
    return parsePackageManifestV2(value) as never;
  }
  const canonical = validateContractDocument('manifest.schema.json', value);
  if (canonical.valid) return normalizeCanonicalManifest(value as ModuleManifestDocument);
  if (isLegacyManifestDocument(value)) return parseLegacyManifest(value);
  fail(`manifest.json does not match the canonical contract. ${canonical.error ?? ''}`.trim());
}

export function parseAnyPackageManifest(value: unknown): InstalledAnyPackageManifest {
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).schemaVersion === 2) {
    return parsePackageManifestV2(value);
  }
  return parsePackageManifest(value);
}

export function parsePackageManifestV2(value: unknown): InstalledPackageManifestV2 {
  const validation = validateContractV2Document('manifest.v2.schema.json', value);
  if (!validation.valid) fail(`manifest.json does not match the canonical v2 contract. ${validation.error ?? ''}`.trim());
  const manifest = value as NADV2AppOrAddOnManifest;
  const id = string(manifest.id, 'manifest.id', 160);
  const slug = string(manifest.slug, 'manifest.slug', 80);
  const version = string(manifest.version, 'manifest.version', 80);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id)) fail('manifest.id must be a reverse-domain identifier.');
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) fail('manifest.slug must be kebab-case.');
  if (!semverPattern.test(version)) fail('manifest.version must be SemVer.');
  const category = string(manifest.category, 'manifest.category', 30) as ModuleCategory;
  if (!categories.has(category)) fail(`Unsupported Module category: ${category}.`);
  const permissions = parsePermissions(manifest.permissions as never);
  if (!permissions.some(({ action }) => action === 'view')) fail('Every App or Add-on must declare a view permission.');
  const permissionActions = new Set(permissions.map(({ action }) => action));
  const capabilities = manifest.capabilities.map((entry, index) => {
    if (!allowedV2Capabilities.has(entry.name)) fail(`Unsupported v2 capability: ${entry.name}.`);
    return {
      name: entry.name,
      reason: string(entry.reason, `manifest.capabilities[${index}].reason`, 300),
    };
  });
  if (new Set(capabilities.map(({ name }) => name)).size !== capabilities.length) fail('Duplicate v2 capability.');
  const operations = manifest.operations ?? {};
  for (const [name, operation] of Object.entries(operations)) {
    if (!permissionActions.has(operation.permission)) fail(`Operation ${name} references an undeclared permission.`);
    if (operation.kind === 'mutation' && !operation.auditAction) fail(`Mutation operation ${name} must declare auditAction.`);
    if (manifest.kind === 'addon' && operation.connection !== 'none') {
      fail(`Add-on operation ${name} cannot access an App connection directly.`);
    }
  }
  if (manifest.kind === 'app') {
    if (manifest.dependencies?.length) fail('Apps cannot declare App dependencies.');
    if (!manifest.connections) fail('Apps must declare their connection schema.');
  } else {
    if (manifest.connections || manifest.httpAccess?.length) fail('Add-ons cannot declare connections or direct HTTP access.');
    if (!manifest.dependencies?.length) fail('Add-ons must declare at least one App dependency.');
    if (!capabilities.some(({ name }) => name === 'apps.invoke')) fail('Add-ons must request apps.invoke.');
  }
  return {
    schemaVersion: 2,
    kind: manifest.kind,
    id,
    slug,
    name: string(manifest.name, 'manifest.name', 100),
    description: string(manifest.description, 'manifest.description', 500),
    icon: string(manifest.icon, 'manifest.icon', 80),
    category,
    version,
    publisher: string(manifest.publisher, 'manifest.publisher', 120),
    compatibility: {
      core: string(manifest.compatibility.core, 'manifest.compatibility.core', 80),
      hostApi: string(manifest.compatibility.hostApi, 'manifest.compatibility.hostApi', 20),
      uiApi: string(manifest.compatibility.uiApi, 'manifest.compatibility.uiApi', 20),
    },
    capabilities,
    permissions,
    ...(manifest.connections ? { connections: manifest.connections } : {}),
    ...(manifest.httpAccess ? { httpAccess: manifest.httpAccess } : {}),
    ...(manifest.dependencies ? { dependencies: manifest.dependencies } : {}),
    operations: { ...operations },
    surfaces: manifest.surfaces,
    configSchema: [],
    entrypoints: {},
  };
}

export function parseConnectionSchemaV2(value: unknown): NADV2ConnectionProfileSchema {
  const validation = validateContractV2Document('connection-schema.v2.schema.json', value);
  if (!validation.valid) fail(`schemas/connections.json does not match the canonical v2 contract. ${validation.error ?? ''}`.trim());
  return value as NADV2ConnectionProfileSchema;
}

export function connectionSchemaToConfigFields(schema: NADV2ConnectionProfileSchema): ConfigField[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties).map(([key, field]) => {
    const control = field['x-nad'].control;
    const type: ConfigField['type'] = control === 'secret' ? 'secret'
      : control === 'url' ? 'url'
        : control === 'number' ? 'number'
          : control === 'boolean' ? 'boolean'
            : control === 'select' ? 'select'
              : 'text';
    const options = field['x-nad'].options
      ?? field.enum?.map((value) => ({ label: String(value), value: String(value) }));
    return {
      key,
      label: field.title,
      type,
      required: required.has(key),
      ...(field['x-nad'].placeholder ? { placeholder: field['x-nad'].placeholder } : {}),
      ...(field.description ? { description: field.description } : {}),
      ...(field.default === undefined ? {} : { defaultValue: field.default }),
      ...(field.minimum === undefined ? {} : { min: field.minimum }),
      ...(field.maximum === undefined ? {} : { max: field.maximum }),
      ...(options?.length ? { options } : {}),
    };
  });
}

export function applyConnectionSchemaV2(
  manifest: InstalledPackageManifestV2,
  schema: NADV2ConnectionProfileSchema | undefined,
): InstalledPackageManifestV2 {
  return {
    ...manifest,
    configSchema: schema ? connectionSchemaToConfigFields(schema) : [],
  };
}

export function parseSurfaceDocumentV2(value: unknown): NADUIAPIV2Surfaces {
  const validation = validateContractV2Document('ui-surfaces.v2.schema.json', value);
  if (!validation.valid) fail(`ui/surfaces.json does not match the canonical v2 contract. ${validation.error ?? ''}`.trim());
  return value as NADUIAPIV2Surfaces;
}

export function parseWidgetDocument(value: unknown): InstalledWidgetDocument {
  const canonical = validateContractDocument('ui-widgets.schema.json', value);
  if (canonical.valid) return normalizeCanonicalWidgetDocument(value as ModuleWidgetsDocument);
  if (isLegacyWidgetDocument(value)) return parseLegacyWidgetDocument(value);
  fail(`ui/widgets.json does not match the canonical contract. ${canonical.error ?? ''}`.trim());
}

export function parsePageDocument(value: unknown): InstalledPageDocument {
  const canonical = validateContractDocument('ui-pages.schema.json', value);
  if (canonical.valid) return normalizeCanonicalPageDocument(value as ModulePagesDocument);
  if (isLegacyPageDocument(value)) return parseLegacyPageDocument(value);
  fail(`ui/pages.json does not match the canonical contract. ${canonical.error ?? ''}`.trim());
}

export function parseChecksums(value: unknown): PackageChecksums {
  validateCanonicalDocument('checksums.schema.json', value, 'checksums.json');
  const item = value as ModuleChecksumsDocument;
  const result: Record<string, string> = {};
  for (const [path, digest] of Object.entries(item.files)) {
    result[safeRelativePath(path, 'checksums path')] = string(digest, `checksum for ${path}`, 64).toLowerCase();
  }
  return {
    schemaVersion: 1,
    algorithm: 'sha256',
    files: result,
  };
}

export function parseSignature(value: unknown): PackageSignature {
  validateCanonicalDocument('signature.schema.json', value, 'signature.json');
  const item = value as ModuleSignatureDocument;
  if (item.mode === 'unsigned-dev') {
    return {
      schemaVersion: 1,
      mode: 'unsigned-dev',
      warning: string(item.warning, 'signature.warning', 500),
      signedPayload: item.signedPayload,
    };
  }
  return {
    schemaVersion: 1,
    mode: 'signed',
    algorithm: 'Ed25519',
    keyId: string(item.keyId, 'signature.keyId', 120),
    signature: string(item.signature, 'signature.signature', 1024),
    signedPayload: item.signedPayload,
  };
}

export function parseJsonFile(buffer: Buffer, label: string): unknown {
  try {
    return JSON.parse(buffer.toString('utf8')) as unknown;
  } catch {
    throw new ModulePackageError(`${label} is not valid JSON.`, 'INVALID_PACKAGE');
  }
}
