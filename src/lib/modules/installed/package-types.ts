import type {
  ModuleChecksumsDocument,
  ModuleManifestDocument,
  ModulePagesDocument,
  ModuleSignatureDocument,
  ModuleWidgetsDocument,
} from '@/lib/modules/contracts/v1';
import type {
  NADV2AppOperation,
  NADV2AppOrAddOnManifest,
  NADV2ConnectionProfileSchema,
  NADV2ScopedHTTPAccess,
  NADUIAPIV2Surfaces,
} from '@/lib/modules/contracts/v2';
import type {
  ConfigField,
  InstalledPageView,
  InstalledWidgetView,
  ModuleCapability,
  ModuleCategory,
  ModuleCompatibility,
  ModuleEntrypoint,
  ModuleHttpAccessScope,
  PermissionDefinition,
} from '@/lib/modules/types';

export interface InstalledPackageManifest {
  schemaVersion: 1;
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: ModuleCategory;
  version: string;
  publisher: string;
  compatibility: ModuleCompatibility;
  capabilities: ModuleCapability[];
  httpAccess?: ModuleHttpAccessScope[];
  permissions: PermissionDefinition[];
  configSchema: ConfigField[];
  entrypoints: Record<string, ModuleEntrypoint>;
}

export interface InstalledPackageManifestSource extends InstalledPackageManifest {
  dataMigrations?: ModuleManifestDocument['dataMigrations'];
}

export interface InstalledPackageManifestV2 {
  schemaVersion: 2;
  kind: 'app' | 'addon';
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: ModuleCategory;
  version: string;
  publisher: string;
  compatibility: ModuleCompatibility;
  capabilities: ModuleCapability[];
  permissions: PermissionDefinition[];
  connections?: NADV2AppOrAddOnManifest['connections'];
  httpAccess?: NADV2ScopedHTTPAccess[];
  dependencies?: NonNullable<NADV2AppOrAddOnManifest['dependencies']>;
  operations: Record<string, NADV2AppOperation>;
  surfaces: 'ui/surfaces.json';
  // Core renders v2 surfaces separately; these aliases let existing registry
  // consumers remain a v1 compatibility surface during the migration.
  configSchema: ConfigField[];
  entrypoints: Record<string, ModuleEntrypoint>;
}

export type InstalledAnyPackageManifest = InstalledPackageManifestSource | InstalledPackageManifestV2;

export interface InstalledWidgetDocument {
  schemaVersion: 1;
  widgets: Array<{
    id: string;
    name: string;
    description: string;
    defaultSize: { w: number; h: number };
    minSize?: { w: number; h: number };
    maxSize?: { w: number; h: number };
    requiredConfig?: string[];
    view: InstalledWidgetView;
  }>;
}

export interface InstalledPageDocument {
  schemaVersion: 1;
  pages: Array<{
    path: string;
    title: string;
    icon?: string;
    view: InstalledPageView;
  }>;
}

export type RawInstalledPackageManifest = ModuleManifestDocument;
export type RawInstalledWidgetDocument = ModuleWidgetsDocument;
export type RawInstalledPageDocument = ModulePagesDocument;
export type PackageChecksums = ModuleChecksumsDocument;
export type PackageSignature = ModuleSignatureDocument;

export interface VerifiedModulePackage {
  manifest: InstalledAnyPackageManifest;
  rawManifest: RawInstalledPackageManifest | NADV2AppOrAddOnManifest;
  pages: InstalledPageDocument;
  rawPages: RawInstalledPageDocument;
  widgets: InstalledWidgetDocument;
  rawWidgets: RawInstalledWidgetDocument;
  checksums: PackageChecksums;
  signature: PackageSignature;
  digest: string;
  files: ReadonlyMap<string, Buffer>;
  signatureStatus: 'verified' | 'development';
  signerKeyId?: string;
  connectionSchema?: NADV2ConnectionProfileSchema;
  surfaces?: NADUIAPIV2Surfaces;
}

export class ModulePackageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ModulePackageError';
  }
}
