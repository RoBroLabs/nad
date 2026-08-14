import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { listConnectionProfilesForUser } from '@/lib/modules/connections';
import {
  getAllInstalledModules,
  getInstalledModule,
  type InstalledModuleDefinition,
} from '@/lib/modules/installed/provider';
import {
  getSurfaceDefinition,
  canAccessInstalledSurface,
  readVerifiedSurfaceEntryHtml,
} from '@/lib/modules/installed/surfaces';

interface RouteContext {
  params: Promise<{ moduleSlug: string; surfaceId: string }>;
}

interface AddonDependency {
  alias: string;
  appId: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function dependencyForAlias(
  definition: InstalledModuleDefinition,
  alias: string,
): AddonDependency | undefined {
  for (const value of definition.dependencies) {
    const dependency = record(value);
    if (
      dependency?.alias === alias
      && typeof dependency.appId === 'string'
    ) {
      return { alias, appId: dependency.appId };
    }
  }
  return undefined;
}

function connectionOwner(
  definition: InstalledModuleDefinition,
  target: string,
): InstalledModuleDefinition | undefined {
  const appId = target === 'self'
    ? (definition.packageKind === 'app' ? definition.moduleId : undefined)
    : dependencyForAlias(definition, target)?.appId;
  if (!appId) return undefined;
  return getAllInstalledModules().find((candidate) => (
    candidate.moduleId === appId
    && candidate.packageKind === 'app'
    && candidate.packageSchemaVersion === 2
    && candidate.enabled
    && candidate.lifecycleState === 'active'
  ));
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const blocked = await enforceApiAccessLock(request);
  if (blocked) return blocked;
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { moduleSlug, surfaceId } = await context.params;
  const surface = getSurfaceDefinition(moduleSlug, surfaceId);
  const definition = getInstalledModule(moduleSlug);
  if (!surface || !definition || definition.releaseId !== surface.releaseId) {
    return NextResponse.json({ error: 'Surface not found', code: 'SURFACE_NOT_FOUND' }, { status: 404 });
  }
  if (!await canAccessInstalledSurface(session.user.id, moduleSlug, surfaceId)) {
    return NextResponse.json({ error: 'Surface access unavailable', code: 'SURFACE_ACCESS_DENIED' }, { status: 403 });
  }

  const entry = await readVerifiedSurfaceEntryHtml(moduleSlug, surfaceId);
  if (entry.releaseId !== surface.releaseId) {
    return NextResponse.json({ error: 'Surface changed during loading', code: 'SURFACE_RELEASE_CHANGED' }, { status: 409 });
  }

  const connectionSlots = await Promise.all(surface.surface.connectionSlots.map(async (slot) => {
    const owner = connectionOwner(definition, slot.target);
    const profiles = owner
      ? await listConnectionProfilesForUser(owner.moduleId, session.user.id)
      : [];
    const selected = profiles.find(({ isDefault }) => isDefault) ?? profiles[0];
    return {
      slot: slot.id,
      label: slot.id.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
      required: slot.required,
      profiles: profiles.map(({ id, name }) => ({ id, name })),
      selectedProfileId: selected?.id ?? null,
    };
  }));

  return NextResponse.json({
    data: {
      html: entry.html,
      digest: entry.digest,
      releaseId: entry.releaseId,
      bindings: surface.surface.bindings.map(({ id }) => id),
      connectionSlots,
    },
  }, {
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
