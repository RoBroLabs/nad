// =============================================================================
// Module System — Core Type Definitions
// =============================================================================
// These types are the contract between the core system and all modules.
// Every module manifest must conform to these interfaces.
// =============================================================================

// -----------------------------------------------------------------------------
// Module Manifest
// -----------------------------------------------------------------------------

/**
 * The root configuration object every module must export from its manifest.ts.
 * This tells the core system everything it needs to know about a module.
 */
export interface ModuleManifest {
  /** Immutable reverse-domain identity for installed Modules. */
  moduleId?: string;

  /** Stable route slug declared by the verified installed package. */
  slug: string;

  /** Human-readable display name */
  name: string;

  /** Short description shown on the module settings page */
  description: string;

  /** Lucide icon name (e.g., 'server', 'film', 'gamepad-2') */
  icon: string;

  /** Sidebar category grouping */
  category: ModuleCategory;

  /** Semantic version string */
  version: string;

  /** Definition source; omitted by legacy manifests and treated as static. */
  source?: 'static' | 'installed';

  /** Publisher metadata copied from a verified installed package. */
  publisher?: string;

  /** Installed-package compatibility contract. */
  compatibility?: ModuleCompatibility;

  /** Brokered core services requested by the Module. */
  capabilities?: ModuleCapability[];

  /** Exact destinations available through the brokered http.request service. */
  httpAccess?: ModuleHttpAccessScope[];

  /** Server endpoints declared by an installed package. */
  entrypoints?: Record<string, ModuleEntrypoint>;

  /** Configuration fields rendered on the module's settings page */
  configSchema: ConfigField[];

  /** Dashboard widgets this module provides */
  widgets: WidgetDefinition[];

  /** Full pages this module adds to the sidebar */
  pages: PageDefinition[];

  /** Permission actions this module supports for RBAC */
  permissions: PermissionDefinition[];
}

export type ModuleCategory =
  | 'servers'
  | 'media'
  | 'games'
  | 'network'
  | 'tools'
  | 'automation'
  | 'monitoring'
  | 'custom';

export interface ModuleCompatibility {
  core: string;
  hostApi: string;
  uiApi: string;
}

export interface ModuleCapability {
  name: string;
  reason: string;
}

/** Exact brokered HTTP destination declared by an installed Module package. */
export interface ModuleHttpAccessScope {
  scheme: 'http' | 'https';
  hostConfig: string;
  port?: number;
  portConfig?: string;
  path: string;
  methods: Array<'GET' | 'POST' | 'PUT' | 'DELETE'>;
  effect?: 'read' | 'write';
  requestBodyPolicy?: 'graphql-query' | 'credential-only' | 'session-cleanup';
  allowedHeaders?: string[];
  queryParameters?: string[];
  pathParameters?: Record<string, 'segment' | 'integer'>;
  credential?: {
    config: string;
    location: 'header' | 'query' | 'json-body';
    name: string;
    prefix?: string;
    publicConfig?: string;
    separator?: string;
  };
  tlsVerifyConfig?: string;
}

export interface ModuleEntrypoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  kind: 'query' | 'mutation';
  permission: string;
  handler: string;
  requestSchema?: string;
  responseSchema?: string;
  auditAction?: string;
  timeoutClass: 'short' | 'standard' | 'action';
  maxRequestBytes: number;
  maxResponseBytes: number;
}

// -----------------------------------------------------------------------------
// Configuration Schema
// -----------------------------------------------------------------------------

export type ConfigFieldType =
  | 'text'
  | 'url'
  | 'secret'
  | 'number'
  | 'boolean'
  | 'select';

/**
 * Defines a single configuration field on the module's settings page.
 * Admins fill these in via the UI — values are stored in the database.
 */
export interface ConfigField {
  /** Storage key (snake_case, e.g., 'plex_api_key') */
  key: string;

  /** Display label shown next to the input */
  label: string;

  /** Input type — 'secret' fields are encrypted at rest */
  type: ConfigFieldType;

  /** Whether the field must be filled before the module can activate */
  required: boolean;

  /** Placeholder text inside the input */
  placeholder?: string;

  /** Help text shown below the input */
  description?: string;

  /** Options for 'select' type fields */
  options?: SelectOption[];

  /** Default value if not configured */
  defaultValue?: string | number | boolean;

  /** Validation: minimum value (for 'number' type) */
  min?: number;

  /** Validation: maximum value (for 'number' type) */
  max?: number;
}

export interface SelectOption {
  label: string;
  value: string;
}

// -----------------------------------------------------------------------------
// Widget Definitions
// -----------------------------------------------------------------------------

/**
 * Grid size in layout units (1 unit ≈ column width, varies by breakpoint).
 */
export interface GridSize {
  /** Width in grid columns */
  w: number;
  /** Height in grid rows */
  h: number;
}

/**
 * Declares a widget that a module provides to the dashboard.
 */
export interface WidgetDefinition {
  /** Unique ID within the module (kebab-case, e.g., 'now-playing') */
  id: string;

  /** Display name shown in widget header and add-widget picker */
  name: string;

  /** Description shown when browsing available widgets */
  description: string;

  /** Default grid size when first placed on a dashboard */
  defaultSize: GridSize;

  /** Minimum allowed size (prevents resize below this) */
  minSize?: GridSize;

  /** Maximum allowed size (prevents resize above this) */
  maxSize?: GridSize;

  /** Auto-refresh interval in milliseconds. 0 or undefined = no auto-refresh. */
  refreshInterval?: number;

  /**
   * Config keys that must be set for this widget to render.
   * If any are missing, the widget shows a "configure module" prompt instead.
   */
  requiredConfig?: string[];

  /** Declarative renderer contract for an installed Module Widget. */
  installedView?: InstalledWidgetView;
  /** Signed schema-v2 opaque-origin surface rendered through the UI bridge. */
  sandboxSurfaceId?: string;
}

// -----------------------------------------------------------------------------
// Page Definitions
// -----------------------------------------------------------------------------

/**
 * Declares a full page that a module adds to the sidebar navigation.
 */
export interface PageDefinition {
  /**
   * Route path relative to the module. The current core renders only '/'; use
   * Tabs inside that Page for logical subsections.
   */
  path: string;

  /** Page title — used in sidebar and browser tab */
  title: string;

  /** Lucide icon name for the sidebar sub-item */
  icon?: string;

  /** Declarative renderer contract for an installed Module Page. */
  installedView?: InstalledPageView;
  /** Signed schema-v2 opaque-origin surface rendered through the UI bridge. */
  sandboxSurfaceId?: string;
}

export interface InstalledDataView {
  type: 'metrics' | 'status-list' | 'key-value' | 'table' | 'json';
  endpoint: string;
  emptyMessage?: string;
  refreshInterval?: number;
  body?: InstalledUiElement[];
}

export type InstalledUiElement =
  | { type: 'section'; title?: string; body: InstalledUiElement[] }
  | { type: 'metric'; label: string; valuePath: string; unit?: string; tonePath?: string }
  | { type: 'status'; label: string; valuePath: string; tonePath?: string }
  | { type: 'text'; value?: string; valuePath?: string }
  | { type: 'keyValue'; items: Array<{ label: string; valuePath: string; unit?: string }> }
  | {
      type: 'table';
      rowsPath: string;
      columns: Array<{ key: string; label: string; valuePath: string }>;
      emptyText?: string;
    };

export interface InstalledWidgetView extends InstalledDataView {
  title?: string;
}

export interface InstalledPageSection extends InstalledDataView {
  id: string;
  title: string;
  description?: string;
}

export interface InstalledPageView {
  sections: InstalledPageSection[];
}

// -----------------------------------------------------------------------------
// Permissions
// -----------------------------------------------------------------------------

export type UserRole = 'admin' | 'member' | 'restricted';

/**
 * Declares a permission action that a module supports.
 * Admins assign these per-user in the user management settings.
 */
export interface PermissionDefinition {
  /** Action identifier (e.g., 'view', 'restart', 'configure') */
  action: string;

  /** Display label in the permission settings UI */
  label: string;

  /** Description of what this permission allows */
  description: string;

  /**
   * Descriptive role metadata only. The current core does not auto-grant it;
   * non-administrators require an explicit stored permission.
   */
  defaultRole: UserRole;
}

// -----------------------------------------------------------------------------
// Module Runtime State (used by the registry, not by module authors)
// -----------------------------------------------------------------------------

export type ModuleStatus =
  | 'discovered'  // Installed but disabled
  | 'enabled'     // Admin has toggled it on
  | 'configured'  // All required config fields are filled and surfaces can render
  | 'quarantined'; // Exact active release is blocked by verified security metadata

/**
 * Runtime state of an installed module — managed by the module registry.
 */
export interface ModuleState {
  manifest: ModuleManifest;
  status: ModuleStatus;
  enabledAt?: string;
  error?: string;
}

// -----------------------------------------------------------------------------
// API Response Types
// -----------------------------------------------------------------------------

/** Standard success response from module API routes */
export interface ApiResponse<T = unknown> {
  data: T;
}

/** Standard error response from module API routes */
export interface ApiError {
  error: string;
  code: ErrorCode;
}

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_CONFIGURED'
  | 'UPSTREAM_ERROR'
  | 'CONNECTION_ERROR'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';
