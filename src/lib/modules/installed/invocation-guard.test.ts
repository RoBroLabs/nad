import { describe, expect, it } from 'vitest';
import {
  beginModuleInvocation,
  getModuleInvocationSnapshot,
  startModuleInvocationDrain,
  startModuleMutationDrain,
} from '@/lib/modules/installed/invocation-guard';

describe('installed Module invocation guard', () => {
  it('pins query requests to their resolved release while allowing activation to drain mutations', () => {
    const moduleId = 'dev.robrolabs.query-pin';
    const endQuery = beginModuleInvocation(moduleId, 'release-old', 'query');
    const releaseDrain = startModuleMutationDrain(moduleId, 'operation-update');
    try {
      expect(getModuleInvocationSnapshot(moduleId)).toEqual({
        queryCount: 1,
        mutationCount: 0,
        releaseCounts: { 'release-old': 1 },
        mutationDrainOperationId: 'operation-update',
      });
      expect(() => beginModuleInvocation(moduleId, 'release-old', 'mutation'))
        .toThrow('temporarily paused');
      const endNewQuery = beginModuleInvocation(moduleId, 'release-new', 'query');
      expect(getModuleInvocationSnapshot(moduleId).releaseCounts).toEqual({
        'release-old': 1,
        'release-new': 1,
      });
      endNewQuery();
    } finally {
      releaseDrain();
      endQuery();
    }
    expect(getModuleInvocationSnapshot(moduleId)).toEqual({
      queryCount: 0,
      mutationCount: 0,
      releaseCounts: {},
    });
  });

  it('refuses lifecycle activation while a pinned mutation is still running', () => {
    const moduleId = 'dev.robrolabs.mutation-pin';
    const endMutation = beginModuleInvocation(moduleId, 'release-active', 'mutation');
    try {
      expect(() => startModuleMutationDrain(moduleId, 'operation-update'))
        .toThrow('in-flight mutations');
      expect(getModuleInvocationSnapshot(moduleId)).toMatchObject({
        mutationCount: 1,
        releaseCounts: { 'release-active': 1 },
      });
    } finally {
      endMutation();
      endMutation();
    }
    expect(getModuleInvocationSnapshot(moduleId).mutationCount).toBe(0);
  });

  it('blocks destructive lifecycle work until every pinned request has finished', () => {
    const moduleId = 'dev.robrolabs.full-drain';
    const endQuery = beginModuleInvocation(moduleId, 'release-active', 'query');
    try {
      expect(() => startModuleInvocationDrain(moduleId, 'operation-uninstall'))
        .toThrow('in-flight requests');
    } finally {
      endQuery();
    }

    const releaseDrain = startModuleInvocationDrain(moduleId, 'operation-uninstall');
    try {
      expect(() => beginModuleInvocation(moduleId, 'release-active', 'query'))
        .toThrow('temporarily paused');
      expect(() => beginModuleInvocation(moduleId, 'release-active', 'mutation'))
        .toThrow('temporarily paused');
    } finally {
      releaseDrain();
    }
  });
});
