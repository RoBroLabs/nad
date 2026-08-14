import 'server-only';

import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { VerifiedModulePackage } from '@/lib/modules/installed/package-types';
import { getModuleArtifactDirectory } from '@/lib/runtime/data-dir';

export interface StoredModuleArtifact {
  artifactPath: string;
  created: boolean;
}

export interface ModuleArtifactPointer {
  moduleId: string;
  digest: string;
  artifactPath: string;
}

export interface StagedModuleArtifactRemoval extends ModuleArtifactPointer {
  stagedPath: string;
  existed: boolean;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

async function listArtifactFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('An existing Module artifact contains a symbolic link.');
    if (entry.isDirectory()) files.push(...await listArtifactFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).split('\\').join('/'));
    else throw new Error('An existing Module artifact contains an unsupported file type.');
  }
  return files;
}

async function verifyExistingArtifact(
  root: string,
  artifactPath: string,
  verifiedPackage: VerifiedModulePackage,
): Promise<void> {
  const artifactStat = await lstat(artifactPath);
  if (!artifactStat.isDirectory() || artifactStat.isSymbolicLink()) {
    throw new Error('The existing Module artifact path is not a regular directory.');
  }
  const [resolvedRoot, resolvedArtifact] = await Promise.all([realpath(root), realpath(artifactPath)]);
  if (!isInside(resolvedRoot, resolvedArtifact)) throw new Error('The existing Module artifact resolves outside its data root.');

  const actualPaths = (await listArtifactFiles(resolvedArtifact)).sort();
  const expectedPaths = [...verifiedPackage.files.keys()].sort();
  if (actualPaths.length !== expectedPaths.length || actualPaths.some((path, index) => path !== expectedPaths[index])) {
    throw new Error('The existing Module artifact file inventory does not match the verified package.');
  }
  for (const [relativePath, expected] of verifiedPackage.files) {
    const candidate = join(resolvedArtifact, relativePath);
    const candidateStat = await lstat(candidate);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) {
      throw new Error(`The existing Module artifact file is unsafe: ${relativePath}.`);
    }
    const actual = await readFile(candidate);
    if (!actual.equals(expected)) throw new Error(`The existing Module artifact differs from the verified package: ${relativePath}.`);
  }
}

/**
 * Writes a verified package into an immutable, content-addressed directory.
 * Verification happens before this function; no untrusted archive path is
 * resolved here until the verifier has normalised and accepted it.
 */
export async function storeVerifiedModuleArtifact(
  verifiedPackage: VerifiedModulePackage,
): Promise<StoredModuleArtifact> {
  const root = getModuleArtifactDirectory();
  const finalPath = join(root, verifiedPackage.manifest.id, verifiedPackage.digest);
  if (await pathExists(finalPath)) {
    await verifyExistingArtifact(root, finalPath, verifiedPackage);
    return { artifactPath: finalPath, created: false };
  }

  const stagingRoot = join(root, '.staging');
  const stagingPath = join(stagingRoot, randomUUID());
  await mkdir(stagingPath, { recursive: true, mode: 0o700 });
  try {
    for (const [relativePath, contents] of verifiedPackage.files) {
      const target = join(stagingPath, relativePath);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, contents, { mode: 0o600, flag: 'wx' });
    }
    await mkdir(dirname(finalPath), { recursive: true, mode: 0o700 });
    try {
      await rename(stagingPath, finalPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== 'EEXIST' && code !== 'ENOTEMPTY') || !(await pathExists(finalPath))) throw error;
      await rm(stagingPath, { recursive: true, force: true });
      await verifyExistingArtifact(root, finalPath, verifiedPackage);
      return { artifactPath: finalPath, created: false };
    }
    return { artifactPath: finalPath, created: true };
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

export async function removeNewlyStoredModuleArtifact(
  stored: StoredModuleArtifact,
  verifiedPackage: VerifiedModulePackage,
): Promise<void> {
  if (!stored.created) return;
  const expectedPath = join(
    getModuleArtifactDirectory(),
    verifiedPackage.manifest.id,
    verifiedPackage.digest,
  );
  if (stored.artifactPath !== expectedPath) throw new Error('Refusing to remove an unexpected Module artifact path.');
  const artifactStat = await lstat(expectedPath);
  if (!artifactStat.isDirectory() || artifactStat.isSymbolicLink()) {
    throw new Error('Refusing to remove an unsafe Module artifact path.');
  }
  await rm(expectedPath, { recursive: true, force: false });
}

export async function removeStoredModuleArtifact({
  moduleId,
  digest,
  artifactPath,
}: ModuleArtifactPointer): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Refusing to remove a Module artifact with an invalid digest.');
  const root = getModuleArtifactDirectory();
  const expectedPath = join(root, moduleId, digest);
  if (artifactPath !== expectedPath) throw new Error('Refusing to remove an unexpected Module artifact path.');

  let artifactStat;
  try {
    artifactStat = await lstat(expectedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (!artifactStat.isDirectory() || artifactStat.isSymbolicLink()) {
    throw new Error('Refusing to remove an unsafe Module artifact path.');
  }

  const [resolvedRoot, resolvedArtifact] = await Promise.all([realpath(root), realpath(expectedPath)]);
  if (!isInside(resolvedRoot, resolvedArtifact)) throw new Error('Refusing to remove a Module artifact outside its data root.');
  await rm(expectedPath, { recursive: true, force: false });
  return true;
}

function validateRemovalPointer({ moduleId, digest, artifactPath }: ModuleArtifactPointer): {
  root: string;
  expectedPath: string;
} {
  if (!/^[A-Za-z0-9._-]+$/.test(moduleId)) throw new Error('Refusing to remove a Module artifact with an invalid Module ID.');
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Refusing to remove a Module artifact with an invalid digest.');
  const root = getModuleArtifactDirectory();
  const expectedPath = join(root, moduleId, digest);
  if (artifactPath !== expectedPath) throw new Error('Refusing to remove an unexpected Module artifact path.');
  return { root, expectedPath };
}

export async function assertSafeStoredModuleArtifactPointer(pointer: ModuleArtifactPointer): Promise<void> {
  const { root, expectedPath } = validateRemovalPointer(pointer);
  let artifactStat;
  try {
    artifactStat = await lstat(expectedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!artifactStat.isDirectory() || artifactStat.isSymbolicLink()) {
    throw new Error('Refusing to remove an unsafe Module artifact path.');
  }
  const [resolvedRoot, resolvedArtifact] = await Promise.all([realpath(root), realpath(expectedPath)]);
  if (!isInside(resolvedRoot, resolvedArtifact)) throw new Error('Refusing to remove a Module artifact outside its data root.');
}

/**
 * Atomically moves an artifact out of its executable content-addressed path.
 * Callers can restore the move if their database transition fails, or finalize
 * it only after the matching release state is committed.
 */
export async function stageStoredModuleArtifactRemoval(
  pointer: ModuleArtifactPointer,
  operationId: string,
): Promise<StagedModuleArtifactRemoval> {
  if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new Error('Artifact removal operation ID is invalid.');
  const { root, expectedPath } = validateRemovalPointer(pointer);
  const stagedPath = join(root, '.trash', operationId, pointer.moduleId, pointer.digest);

  let artifactStat;
  try {
    artifactStat = await lstat(expectedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...pointer, stagedPath, existed: false };
    }
    throw error;
  }
  if (!artifactStat.isDirectory() || artifactStat.isSymbolicLink()) {
    throw new Error('Refusing to remove an unsafe Module artifact path.');
  }
  const [resolvedRoot, resolvedArtifact] = await Promise.all([realpath(root), realpath(expectedPath)]);
  if (!isInside(resolvedRoot, resolvedArtifact)) throw new Error('Refusing to remove a Module artifact outside its data root.');

  await mkdir(dirname(stagedPath), { recursive: true, mode: 0o700 });
  await rename(expectedPath, stagedPath);
  return { ...pointer, stagedPath, existed: true };
}

export async function restoreStagedModuleArtifact(removal: StagedModuleArtifactRemoval): Promise<void> {
  if (!removal.existed) return;
  const { expectedPath } = validateRemovalPointer(removal);
  await mkdir(dirname(expectedPath), { recursive: true, mode: 0o700 });
  await rename(removal.stagedPath, expectedPath);
}

export async function finalizeStagedModuleArtifactRemoval(
  removal: StagedModuleArtifactRemoval,
): Promise<boolean> {
  if (!removal.existed) return false;
  await rm(removal.stagedPath, { recursive: true, force: false });
  return true;
}
