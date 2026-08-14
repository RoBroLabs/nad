import type { ConfigFieldType, UserRole } from '@/lib/modules/types';

export interface ModuleReviewCapability {
  name: string;
  reason: string;
}

export interface ModuleReviewPermission {
  action: string;
  label: string;
  description: string;
  defaultRole: UserRole;
}

export interface ModuleReviewConfigField {
  key: string;
  label: string;
  type: ConfigFieldType;
  required: boolean;
  description?: string;
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
  options?: Array<{ label: string; value: string }>;
}

export interface ModuleReviewHttpAccess {
  scheme: 'http' | 'https';
  hostConfig: { key: string; label: string };
  port: number | { key: string; label: string };
  path: string;
  methods: Array<'GET' | 'POST' | 'PUT' | 'DELETE'>;
  effect: 'read' | 'write';
  requestBodyPolicy?: 'graphql-query' | 'credential-only' | 'session-cleanup';
  allowedHeaders: string[];
  queryParameters: string[];
  pathParameters: Record<string, 'segment' | 'integer'>;
  credential?: {
    config: { key: string; label: string };
    location: 'header' | 'query' | 'json-body';
    name: string;
    publicConfig?: { key: string; label: string };
  };
  tlsVerification?: { key: string; label: string };
}

export interface ModuleReviewChange<T> {
  before: T;
  after: T;
}

export interface ModuleUpdateChanges {
  capabilities: {
    added: ModuleReviewCapability[];
    removed: ModuleReviewCapability[];
    changed: Array<ModuleReviewChange<ModuleReviewCapability>>;
  };
  permissions: {
    added: ModuleReviewPermission[];
    removed: ModuleReviewPermission[];
    changed: Array<ModuleReviewChange<ModuleReviewPermission>>;
  };
  configFields: {
    added: ModuleReviewConfigField[];
    removed: ModuleReviewConfigField[];
    changed: Array<ModuleReviewChange<ModuleReviewConfigField>>;
  };
  httpAccess: {
    added: ModuleReviewHttpAccess[];
    removed: ModuleReviewHttpAccess[];
    changed: Array<ModuleReviewChange<ModuleReviewHttpAccess>>;
  };
  dataMigration: {
    mode: 'reuse';
    summary: string;
  };
}

export interface ModuleInstallReview {
  moduleId: string;
  slug: string;
  name: string;
  publisher: string;
  version: string;
  currentVersion?: string;
  operation: 'install' | 'update';
  digest: string;
  signatureStatus: 'verified' | 'development';
  signerKeyId?: string;
  compatibility: { core: string; hostApi: string; uiApi: string };
  capabilities: ModuleReviewCapability[];
  permissions: ModuleReviewPermission[];
  configFields: ModuleReviewConfigField[];
  secretConfigFields: Array<{ key: string; label: string }>;
  networkConfigFields: Array<{ key: string; label: string }>;
  httpAccess: ModuleReviewHttpAccess[];
  changes?: ModuleUpdateChanges;
}
