import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { downloadMarketplaceModule, fetchMarketplaceCatalog, getMarketplaceBaseUrl, getMarketplaceMode } from '@/lib/marketplace/client';
import { installModulePackage } from '@/lib/modules/installed/lifecycle';
import { createModuleInstallReview } from '@/lib/modules/installed/install-review';
import { ModulePackageError } from '@/lib/modules/installed/package-types';
import { verifyModulePackage } from '@/lib/modules/installed/package-verifier';
import { isSameOriginMutationRequest, readJsonObject } from '@/lib/http';
import { refreshAndEnforceMarketplaceSecurity } from '@/lib/marketplace/security-enforcement';

export const runtime = 'nodejs';

const marketplaceInstallConflictCodes = new Set([
  'CONCURRENT_MODIFICATION',
  'IDENTITY_CONFLICT',
  'MODULE_BUSY',
  'MODULE_INVOCATION_DRAINING',
  'MODULE_INVOCATION_IN_FLIGHT',
  'MODULE_LIFECYCLE_BUSY',
  'MODULE_LOCK_LOST',
  'MODULE_MUTATION_DRAINING',
  'MODULE_MUTATION_IN_FLIGHT',
  'MODULE_RELEASE_IN_FLIGHT',
  'VERSION_ALREADY_INSTALLED',
]);

function marketplaceInstallErrorStatus(code: string): number {
  if (code === 'PACKAGE_TOO_LARGE') return 413;
  if (code === 'MARKETPLACE_SECURITY_UNAVAILABLE') return 503;
  if (marketplaceInstallConflictCodes.has(code)) return 409;
  if (code === 'MARKETPLACE_INSTALL_FAILED') return 502;
  return 400;
}

async function requireAdmin(request: Request): Promise<{ user: { id: string } } | NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  return { user: { id: session.user.id } };
}

export async function GET(request: Request): Promise<NextResponse> {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const mode = getMarketplaceMode();
  const configured = Boolean(getMarketplaceBaseUrl());
  if (mode !== 'online' || !configured) return NextResponse.json({ data: { mode, configured, modules: [] } });
  try {
    const [catalog, security] = await Promise.all([
      fetchMarketplaceCatalog(),
      refreshAndEnforceMarketplaceSecurity(),
    ]);
    const activeBySlug = new Map(security.installedFindings
      .filter(({ releaseState }) => releaseState === 'active')
      .map((finding) => [finding.moduleSlug, finding]));
    return NextResponse.json({
      data: {
        mode,
        configured,
        security: {
          freshness: security.freshness,
          lastSucceededAt: security.lastSucceededAt,
          lastErrorCode: security.lastErrorCode,
        },
        modules: catalog.modules.map((listing) => {
          const installed = activeBySlug.get(listing.slug);
          return {
            ...listing,
            installedVersion: installed?.version,
            installedDigest: installed?.digest,
            installState: !installed
              ? 'install'
              : installed.digest === listing.artifact.sha256
                ? 'current'
                : installed.recommendation?.updateAvailable
                  ? 'update'
                  : 'different',
          };
        }),
      },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Marketplace is unavailable.',
      code: 'MARKETPLACE_UNAVAILABLE',
      data: { mode, configured, modules: [] },
    }, { status: 502 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request refused', code: 'CROSS_ORIGIN_REQUEST' }, { status: 403 });
  }
  const mode = getMarketplaceMode();
  if (mode !== 'online') {
    return NextResponse.json({
      error: 'Marketplace access is disabled in manual-install mode.',
      code: 'MARKETPLACE_DISABLED',
    }, { status: 409 });
  }
  if (!getMarketplaceBaseUrl()) {
    return NextResponse.json({
      error: 'NAD_MARKETPLACE_URL is not configured.',
      code: 'MARKETPLACE_NOT_CONFIGURED',
    }, { status: 409 });
  }
  const payload = await readJsonObject(request);
  if (!payload || typeof payload.slug !== 'string' || !/^[a-z][a-z0-9-]*$/.test(payload.slug)) {
    return NextResponse.json({ error: 'Module slug is invalid', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  try {
    const security = await refreshAndEnforceMarketplaceSecurity();
    const recommendation = security.recommendations.find(({ moduleSlug }) => moduleSlug === payload.slug);
    if (security.freshness !== 'current' || !recommendation) {
      throw new ModulePackageError(
        'A current signed Marketplace recommendation is required before installing this Plugin.',
        'MARKETPLACE_SECURITY_UNAVAILABLE',
      );
    }
    const archive = await downloadMarketplaceModule(payload.slug);
    const verified = await verifyModulePackage(archive);
    if (verified.digest !== recommendation.artifactSha256
      || verified.manifest.id !== recommendation.moduleId
      || verified.manifest.slug !== recommendation.moduleSlug
      || verified.manifest.version !== recommendation.version
      || verified.signerKeyId !== recommendation.signerKeyId) {
      throw new ModulePackageError(
        'The Marketplace package does not match its signed recommendation.',
        'BAD_DOWNLOAD',
      );
    }
    if (payload.confirm !== true) {
      return NextResponse.json({ data: { review: createModuleInstallReview(verified) } });
    }
    if (typeof payload.expectedDigest !== 'string') {
      return NextResponse.json({ error: 'Review the Module before installing it', code: 'APPROVAL_REQUIRED' }, { status: 400 });
    }
    const result = await installModulePackage(archive, admin.user.id, { expectedDigest: payload.expectedDigest });
    await logAuditEvent(admin.user.id, result.replacedReleaseId ? 'update_module_from_marketplace' : 'install_module_from_marketplace', result.slug, {
      moduleId: result.moduleId,
      version: result.version,
      operationId: result.operationId,
      signatureStatus: result.signatureStatus,
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    const code = error instanceof ModulePackageError ? error.code : 'MARKETPLACE_INSTALL_FAILED';
    await logAuditEvent(admin.user.id, 'marketplace_install_failed', payload.slug, { code });
    return NextResponse.json(
      {
        error: error instanceof ModulePackageError ? error.message : 'Marketplace install failed.',
        code,
      },
      { status: marketplaceInstallErrorStatus(code) },
    );
  }
}
