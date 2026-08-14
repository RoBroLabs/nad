import { describe, expect, it } from 'vitest';
import {
  createSandboxDocument,
  parseSandboxBridgeRequest,
  SANDBOX_BRIDGE_LIMITS,
} from '@/lib/modules/sandbox-bridge';

const sessionId = 'abcdefghijklmnopqrstuv';

describe('sandbox UI bridge', () => {
  it('accepts a bounded declared binding request', () => {
    expect(parseSandboxBridgeRequest({
      bridgeVersion: 2,
      sessionId,
      messageId: 'message_01',
      type: 'binding.invoke',
      payload: { binding: 'guests', input: { page: 1 } },
    }, sessionId)).toEqual({
      bridgeVersion: 2,
      sessionId,
      messageId: 'message_01',
      type: 'binding.invoke',
      payload: { binding: 'guests', input: { page: 1 } },
    });
  });

  it('rejects a stale session, hostile navigation, invalid resize and oversized input', () => {
    expect(parseSandboxBridgeRequest({
      bridgeVersion: 2, sessionId: 'old', messageId: 'message_01', type: 'surface.ready', payload: {},
    }, sessionId)).toBeUndefined();
    expect(parseSandboxBridgeRequest({
      bridgeVersion: 2, sessionId, messageId: 'message_01', type: 'navigation.request', payload: { path: 'https://evil.example' },
    }, sessionId)).toBeUndefined();
    expect(parseSandboxBridgeRequest({
      bridgeVersion: 2, sessionId, messageId: 'message_01', type: 'resize.request', payload: { height: SANDBOX_BRIDGE_LIMITS.maximumHeight + 1 },
    }, sessionId)).toBeUndefined();
    expect(parseSandboxBridgeRequest({
      bridgeVersion: 2, sessionId, messageId: 'message_01', type: 'binding.invoke', payload: { binding: 'x', input: 'a'.repeat(SANDBOX_BRIDGE_LIMITS.messageBytes) },
    }, sessionId)).toBeUndefined();
  });

  it('nests package markup behind a blob-only frame boundary and deny-by-default CSP', () => {
    const document = createSandboxDocument('<script>window.ready = true</script>');
    expect(document).toContain('frame-src blob:');
    expect(document).toContain('sandbox="allow-scripts"');
    expect(document).toContain('event.source!==parent');
    expect(document).toContain('loadCount>1');
    const encodedPlugin = /decodeURIComponent\("([^"\\]+)"\)/.exec(document)?.[1];
    expect(encodedPlugin).toBeDefined();
    const pluginDocument = decodeURIComponent(encodedPlugin!);
    expect(pluginDocument.indexOf('Content-Security-Policy')).toBeLessThan(pluginDocument.indexOf('<script>window.ready'));
    expect(pluginDocument).toContain("connect-src 'none'");
    expect(pluginDocument).toContain("frame-src 'none'");
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("form-action 'none'");
  });
});
