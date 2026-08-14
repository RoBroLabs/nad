/** Core-owned notification dispatch bound to the invoking Module. */
export type ModuleNotifier = (
  title: string,
  message: string,
  severity?: 'info' | 'warning' | 'critical',
) => Promise<void>;

export interface ModuleApiContext {
  config: Record<string, string>;
  moduleSlug: string;
  path: string[];
  userId: string;
  connectionProfileId?: string;
  connectionGenerationId?: string;
  connectionProfileName?: string;
  correlationId?: string;
  caller?: {
    kind: 'core' | 'app' | 'addon' | 'surface';
    packageId: string;
    surfaceId?: string;
  };
  invokeApp?: (request: {
    dependency: string;
    operation: string;
    connectionProfileId: string;
    input: unknown;
  }) => Promise<unknown>;
  notify: ModuleNotifier;
}

export type ModuleApiHandler = (
  request: Request,
  context: ModuleApiContext,
) => Promise<Response>;
