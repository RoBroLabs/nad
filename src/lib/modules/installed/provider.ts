import 'server-only';

import { rawDb } from '@/lib/db';
import {
  applyConnectionSchemaV2,
  parseAnyPackageManifest,
  parseConnectionSchemaV2,
  parsePageDocument,
  parseWidgetDocument,
} from '@/lib/modules/installed/package-schema';
import type { ModuleManifest } from '@/lib/modules/types';
import type { NADV2ScopedHTTPAccess } from '@/lib/modules/contracts/v2';

interface InstalledReleaseRow {
  module_id: string;
  slug: string;
  enabled: number;
  lifecycle_state: string;
  registry_epoch: number;
  release_id: string;
  active_config_generation_id: string | null;
  active_kv_generation_id: string | null;
  active_grant_generation_id: string | null;
  digest: string;
  signer_key_id: string | null;
  artifact_path: string;
  manifest_json: string;
  package_schema_version: number;
  package_kind: 'app' | 'addon';
  dependencies_json: string;
  operations_json: string;
  surfaces_json: string | null;
  connection_schema_json: string | null;
  ui_pages_json: string;
  ui_widgets_json: string;
  grants_json: string;
}

export interface InstalledModuleDefinition {
  manifest: ModuleManifest;
  moduleId: string;
  releaseId: string;
  configGenerationId: string | null;
  kvGenerationId: string | null;
  grantGenerationId: string | null;
  digest: string;
  signerKeyId?: string | null;
  artifactPath: string;
  enabled: boolean;
  lifecycleState: string;
  registryEpoch: number;
  grantedCapabilities: string[];
  packageSchemaVersion: number;
  packageKind: 'app' | 'addon';
  dependencies: unknown[];
  operations: Record<string, unknown>;
  surfaces: Record<string, unknown> | null;
  v2HttpAccess: NADV2ScopedHTTPAccess[];
}

function parseRow(row: InstalledReleaseRow): InstalledModuleDefinition | undefined {
  try {
    let packageManifest = parseAnyPackageManifest(JSON.parse(row.manifest_json) as unknown);
    const connectionSchema = row.connection_schema_json
      ? parseConnectionSchemaV2(JSON.parse(row.connection_schema_json) as unknown)
      : undefined;
    if (packageManifest.schemaVersion === 2) {
      packageManifest = applyConnectionSchemaV2(packageManifest, connectionSchema);
    }
    const pages = row.package_schema_version === 2
      ? { schemaVersion: 1 as const, pages: [] }
      : parsePageDocument(JSON.parse(row.ui_pages_json) as unknown);
    const widgets = row.package_schema_version === 2
      ? { schemaVersion: 1 as const, widgets: [] }
      : parseWidgetDocument(JSON.parse(row.ui_widgets_json) as unknown);
    const parsedGrants = JSON.parse(row.grants_json) as unknown;
    if (!Array.isArray(parsedGrants) || parsedGrants.some((value) => typeof value !== 'string')) {
      throw new Error('Installed Module capability grants are invalid.');
    }
    const declaredCapabilities = new Set(packageManifest.capabilities.map(({ name }) => name));
    const grantedCapabilities = [...new Set(parsedGrants)].filter((name) => declaredCapabilities.has(name));
    const dependencies = JSON.parse(row.dependencies_json) as unknown;
    const operations = JSON.parse(row.operations_json) as unknown;
    const surfaces = row.surfaces_json ? JSON.parse(row.surfaces_json) as unknown : null;
    if (!Array.isArray(dependencies)) throw new Error('Installed package dependencies are invalid.');
    if (!operations || typeof operations !== 'object' || Array.isArray(operations)) {
      throw new Error('Installed package operations are invalid.');
    }
    if (surfaces !== null && (!surfaces || typeof surfaces !== 'object' || Array.isArray(surfaces))) {
      throw new Error('Installed package surfaces are invalid.');
    }
    const surfaceList = surfaces && Array.isArray((surfaces as { surfaces?: unknown }).surfaces)
      ? (surfaces as { surfaces: unknown[] }).surfaces
      : [];
    const v2Widgets = surfaceList.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const surface = value as Record<string, unknown>;
      const widget = surface.widget && typeof surface.widget === 'object' && !Array.isArray(surface.widget)
        ? surface.widget as Record<string, unknown>
        : null;
      if (surface.kind !== 'widget' || typeof surface.id !== 'string' || typeof surface.name !== 'string' || !widget) return [];
      const size = widget.defaultSize as { w?: unknown; h?: unknown } | undefined;
      if (!size || typeof size.w !== 'number' || typeof size.h !== 'number') return [];
      return [{
        id: surface.id,
        name: surface.name,
        description: typeof surface.description === 'string' ? surface.description : surface.name,
        defaultSize: { w: size.w, h: size.h },
        ...(widget.minSize && typeof widget.minSize === 'object' ? { minSize: widget.minSize as { w: number; h: number } } : {}),
        ...(widget.maxSize && typeof widget.maxSize === 'object' ? { maxSize: widget.maxSize as { w: number; h: number } } : {}),
        sandboxSurfaceId: surface.id,
      }];
    });
    const v2Pages = surfaceList.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const surface = value as Record<string, unknown>;
      const page = surface.page && typeof surface.page === 'object' && !Array.isArray(surface.page)
        ? surface.page as Record<string, unknown>
        : null;
      if (surface.kind !== 'page' || typeof surface.id !== 'string' || typeof surface.name !== 'string' || !page || typeof page.path !== 'string') return [];
      return [{
        path: page.path,
        title: surface.name,
        ...(typeof surface.icon === 'string' ? { icon: surface.icon } : {}),
        sandboxSurfaceId: surface.id,
      }];
    });
    return {
      moduleId: row.module_id,
      releaseId: row.release_id,
      configGenerationId: row.active_config_generation_id,
      kvGenerationId: row.active_kv_generation_id,
      grantGenerationId: row.active_grant_generation_id,
      digest: row.digest,
      signerKeyId: row.signer_key_id,
      artifactPath: row.artifact_path,
      enabled: row.enabled === 1,
      lifecycleState: row.lifecycle_state,
      registryEpoch: row.registry_epoch,
      grantedCapabilities,
      packageSchemaVersion: row.package_schema_version,
      packageKind: row.package_kind,
      dependencies,
      operations: operations as Record<string, unknown>,
      surfaces: surfaces as Record<string, unknown> | null,
      v2HttpAccess: packageManifest.schemaVersion === 2 ? [...(packageManifest.httpAccess ?? [])] : [],
      manifest: {
        moduleId: packageManifest.id,
        slug: packageManifest.slug,
        name: packageManifest.name,
        description: packageManifest.description,
        icon: packageManifest.icon,
        category: packageManifest.category,
        version: packageManifest.version,
        source: 'installed',
        publisher: packageManifest.publisher,
        compatibility: packageManifest.compatibility,
        capabilities: packageManifest.capabilities,
        httpAccess: packageManifest.schemaVersion === 1 ? packageManifest.httpAccess : undefined,
        configSchema: packageManifest.configSchema,
        permissions: packageManifest.permissions,
        entrypoints: packageManifest.entrypoints,
        widgets: packageManifest.schemaVersion === 2 ? v2Widgets : widgets.widgets.map((widget) => ({
          id: widget.id,
          name: widget.name,
          description: widget.description,
          defaultSize: widget.defaultSize,
          minSize: widget.minSize,
          maxSize: widget.maxSize,
          requiredConfig: widget.requiredConfig,
          refreshInterval: widget.view.refreshInterval,
          installedView: widget.view,
        })),
        pages: packageManifest.schemaVersion === 2 ? v2Pages : pages.pages.map((page) => ({
          path: page.path,
          title: page.title,
          icon: page.icon,
          installedView: page.view,
        })),
      },
    };
  } catch (error) {
    console.error('Installed Module metadata is invalid', { moduleId: row.module_id, releaseId: row.release_id, error });
    return undefined;
  }
}

export function getAllInstalledModules(): InstalledModuleDefinition[] {
  if (process.env.NAD_BUILD_EPHEMERAL_DB === '1') return [];
  const rows = rawDb.prepare(`
    SELECT
      installed_modules.module_id,
      installed_modules.slug,
      installed_modules.enabled,
      installed_modules.lifecycle_state,
      installed_modules.registry_epoch,
      installed_modules.active_config_generation_id,
      installed_modules.active_kv_generation_id,
      installed_modules.active_grant_generation_id,
      module_releases.id AS release_id,
      module_releases.digest,
      module_releases.signer_key_id,
      module_releases.artifact_path,
      module_releases.manifest_json,
      module_releases.package_schema_version,
      module_releases.package_kind,
      module_releases.dependencies_json,
      module_releases.operations_json,
      module_releases.surfaces_json,
      module_releases.connection_schema_json,
      module_releases.ui_pages_json,
      module_releases.ui_widgets_json,
      module_capability_grant_generations.grants_json
    FROM installed_modules
    JOIN module_releases ON module_releases.id = installed_modules.active_release_id
    JOIN module_capability_grant_generations
      ON module_capability_grant_generations.id = installed_modules.active_grant_generation_id
    WHERE installed_modules.active_release_id IS NOT NULL
    ORDER BY installed_modules.slug
  `).all() as InstalledReleaseRow[];
  return rows.map(parseRow).filter((definition): definition is InstalledModuleDefinition => Boolean(definition));
}

export function getInstalledModule(slug: string): InstalledModuleDefinition | undefined {
  return getAllInstalledModules().find((definition) => definition.manifest.slug === slug);
}
