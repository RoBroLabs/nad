import 'server-only';

import { ModulePackageError } from '@/lib/modules/installed/package-types';

export type ModuleInvocationKind = 'query' | 'mutation';

interface InvocationState {
  queryCount: number;
  mutationCount: number;
  releaseCounts: Map<string, number>;
  mutationDrainOperationId?: string;
  invocationDrainOperationId?: string;
}

export interface ModuleInvocationSnapshot {
  queryCount: number;
  mutationCount: number;
  releaseCounts: Record<string, number>;
  mutationDrainOperationId?: string;
  invocationDrainOperationId?: string;
}

const states = new Map<string, InvocationState>();

function stateFor(moduleId: string): InvocationState {
  const current = states.get(moduleId);
  if (current) return current;
  const created: InvocationState = {
    queryCount: 0,
    mutationCount: 0,
    releaseCounts: new Map(),
  };
  states.set(moduleId, created);
  return created;
}

function maybeDeleteState(moduleId: string, state: InvocationState): void {
  if (
    state.queryCount === 0
    && state.mutationCount === 0
    && state.releaseCounts.size === 0
    && !state.mutationDrainOperationId
    && !state.invocationDrainOperationId
  ) {
    states.delete(moduleId);
  }
}

export function beginModuleInvocation(
  moduleId: string,
  releaseId: string,
  kind: ModuleInvocationKind,
): () => void {
  const state = stateFor(moduleId);
  if (state.invocationDrainOperationId) {
    throw new ModulePackageError(
      'Module requests are temporarily paused while a destructive lifecycle operation completes. Retry shortly.',
      'MODULE_INVOCATION_DRAINING',
    );
  }
  if (kind === 'mutation' && state.mutationDrainOperationId) {
    throw new ModulePackageError(
      'Module mutations are temporarily paused while a lifecycle operation completes. Retry shortly.',
      'MODULE_MUTATION_DRAINING',
    );
  }

  if (kind === 'mutation') state.mutationCount += 1;
  else state.queryCount += 1;
  state.releaseCounts.set(releaseId, (state.releaseCounts.get(releaseId) ?? 0) + 1);

  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    if (kind === 'mutation') state.mutationCount = Math.max(0, state.mutationCount - 1);
    else state.queryCount = Math.max(0, state.queryCount - 1);
    const releaseCount = (state.releaseCounts.get(releaseId) ?? 1) - 1;
    if (releaseCount > 0) state.releaseCounts.set(releaseId, releaseCount);
    else state.releaseCounts.delete(releaseId);
    maybeDeleteState(moduleId, state);
  };
}

export function startModuleInvocationDrain(moduleId: string, operationId: string): () => void {
  const state = stateFor(moduleId);
  if (
    (state.invocationDrainOperationId && state.invocationDrainOperationId !== operationId)
    || (state.mutationDrainOperationId && state.mutationDrainOperationId !== operationId)
  ) {
    throw new ModulePackageError(
      'Another Module lifecycle operation is already draining requests.',
      'MODULE_LIFECYCLE_BUSY',
    );
  }
  if (state.queryCount > 0 || state.mutationCount > 0) {
    throw new ModulePackageError(
      'Module has in-flight requests. Retry the destructive lifecycle operation after they finish.',
      'MODULE_INVOCATION_IN_FLIGHT',
    );
  }
  state.invocationDrainOperationId = operationId;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (state.invocationDrainOperationId === operationId) delete state.invocationDrainOperationId;
    maybeDeleteState(moduleId, state);
  };
}

export function assertModuleReleasesIdle(moduleId: string, releaseIds: readonly string[]): void {
  const state = states.get(moduleId);
  if (!state) return;
  if (releaseIds.some((releaseId) => (state.releaseCounts.get(releaseId) ?? 0) > 0)) {
    throw new ModulePackageError(
      'A retained Module release still has an in-flight request. Retry pruning after it finishes.',
      'MODULE_RELEASE_IN_FLIGHT',
    );
  }
}

export function startModuleMutationDrain(moduleId: string, operationId: string): () => void {
  const state = stateFor(moduleId);
  if (state.mutationDrainOperationId && state.mutationDrainOperationId !== operationId) {
    throw new ModulePackageError(
      'Another Module lifecycle operation is already draining mutations.',
      'MODULE_LIFECYCLE_BUSY',
    );
  }
  if (state.mutationCount > 0) {
    throw new ModulePackageError(
      'Module has in-flight mutations. Retry the lifecycle operation after they finish.',
      'MODULE_MUTATION_IN_FLIGHT',
    );
  }
  state.mutationDrainOperationId = operationId;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (state.mutationDrainOperationId === operationId) delete state.mutationDrainOperationId;
    maybeDeleteState(moduleId, state);
  };
}

export function getModuleInvocationSnapshot(moduleId: string): ModuleInvocationSnapshot {
  const state = states.get(moduleId);
  if (!state) {
    return { queryCount: 0, mutationCount: 0, releaseCounts: {} };
  }
  return {
    queryCount: state.queryCount,
    mutationCount: state.mutationCount,
    releaseCounts: Object.fromEntries(state.releaseCounts),
    mutationDrainOperationId: state.mutationDrainOperationId,
    invocationDrainOperationId: state.invocationDrainOperationId,
  };
}
