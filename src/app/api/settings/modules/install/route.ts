import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { logAuditEvent } from '@/lib/db/audit';
import { installModulePackage } from '@/lib/modules/installed/lifecycle';
import { createModuleInstallReview } from '@/lib/modules/installed/install-review';
import { MODULE_ARCHIVE_LIMITS } from '@/lib/modules/installed/package-verifier';
import { verifyModulePackage } from '@/lib/modules/installed/package-verifier';
import { ModulePackageError } from '@/lib/modules/installed/package-types';
import {
  isSameOriginMutationRequest,
  readBodyBytes,
  RequestBodyTooLargeError,
} from '@/lib/http';

export const runtime = 'nodejs';

const MAX_MULTIPART_OVERHEAD_BYTES = 1_048_576;
const MAX_UPLOAD_BODY_BYTES = MODULE_ARCHIVE_LIMITS.compressedBytes + MAX_MULTIPART_OVERHEAD_BYTES;

const installConflictCodes = new Set([
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

function installErrorStatus(code: string): number {
  if (code === 'PACKAGE_TOO_LARGE') return 413;
  if (installConflictCodes.has(code)) return 409;
  return 400;
}

export async function POST(request: Request): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  if (!isSameOriginMutationRequest(request)) {
    return NextResponse.json({ error: 'Cross-origin request refused', code: 'CROSS_ORIGIN_REQUEST' }, { status: 403 });
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BODY_BYTES) {
    return NextResponse.json({ error: 'Module archive is too large', code: 'PACKAGE_TOO_LARGE' }, { status: 413 });
  }

  try {
    const body = await readBodyBytes(
      request.body,
      MAX_UPLOAD_BODY_BYTES,
      'Module upload body is too large',
    );
    const uploadBody = new ArrayBuffer(body.byteLength);
    new Uint8Array(uploadBody).set(body);
    const boundedRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: uploadBody,
    });
    const form = await boundedRequest.formData();
    const upload = form.get('module');
    if (!(upload instanceof File) || !upload.name.toLowerCase().endsWith('.nadmod')) {
      return NextResponse.json({ error: 'Choose a .nadmod file', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (upload.size === 0 || upload.size > MODULE_ARCHIVE_LIMITS.compressedBytes) {
      return NextResponse.json({ error: 'Module archive is empty or too large', code: 'PACKAGE_TOO_LARGE' }, { status: 413 });
    }
    const archive = Buffer.from(await upload.arrayBuffer());
    const confirmed = form.get('confirm') === 'true';
    const expectedDigest = form.get('expectedDigest');
    if (!confirmed) {
      const verified = await verifyModulePackage(archive);
      return NextResponse.json({ data: { review: createModuleInstallReview(verified) } });
    }
    if (typeof expectedDigest !== 'string') {
      return NextResponse.json({ error: 'Review the Module before installing it', code: 'APPROVAL_REQUIRED' }, { status: 400 });
    }
    const result = await installModulePackage(archive, session.user.id, { expectedDigest });
    await logAuditEvent(session.user.id, result.replacedReleaseId ? 'update_module' : 'install_module', result.slug, {
      moduleId: result.moduleId,
      version: result.version,
      signatureStatus: result.signatureStatus,
      operationId: result.operationId,
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      await logAuditEvent(session.user.id, 'reject_module_install', undefined, { code: 'PACKAGE_TOO_LARGE' });
      return NextResponse.json({ error: 'Module archive is too large', code: 'PACKAGE_TOO_LARGE' }, { status: 413 });
    }
    if (error instanceof ModulePackageError) {
      await logAuditEvent(session.user.id, 'reject_module_install', undefined, { code: error.code });
      return NextResponse.json({ error: error.message, code: error.code }, { status: installErrorStatus(error.code) });
    }
    console.error('Module install failed', {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    await logAuditEvent(session.user.id, 'module_install_failed', undefined, { code: 'INTERNAL_ERROR' });
    return NextResponse.json({ error: 'The Module could not be installed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
