import type { NADUIAPIV2MessageChannelEnvelope } from '@/lib/modules/contracts/v2';

export const NAD_UI_BRIDGE_VERSION = 2 as const;

export const SANDBOX_BRIDGE_LIMITS = {
  messageBytes: 64 * 1024,
  diagnosticMessageLength: 500,
  navigationPathLength: 120,
  minimumHeight: 160,
  maximumHeight: 1_200,
  pendingRequests: 8,
  requestsPerMinute: 60,
} as const;

interface BridgeBase {
  bridgeVersion: 2;
  sessionId: string;
  messageId: string;
  replyTo?: string;
}

export type SandboxBridgeRequest =
  | (BridgeBase & { type: 'surface.ready'; payload: Record<string, never> })
  | (BridgeBase & { type: 'binding.invoke'; payload: { binding: string; input?: unknown } })
  | (BridgeBase & { type: 'resize.request'; payload: { width?: number; height: number } })
  | (BridgeBase & { type: 'navigation.request'; payload: { path: string } })
  | (BridgeBase & { type: 'connection.select.request'; payload: { slot: string } })
  | (BridgeBase & {
      type: 'diagnostic.emit';
      payload: {
        level: 'debug' | 'info' | 'warning' | 'error';
        code: string;
        message: string;
        metadata?: Record<string, string | number | boolean | null>;
      };
    });

export interface SandboxConnectionSummary {
  id: string;
  name: string;
}

export interface SandboxSurfaceContext {
  moduleSlug: string;
  surfaceId: string;
  bindings: string[];
  connectionSlots: Array<{
    slot: string;
    selectedProfileId: string | null;
    profiles: SandboxConnectionSummary[];
  }>;
  theme: 'dark' | 'light';
}

export type SandboxBridgeResponse = BridgeBase & {
  type: Extract<NADUIAPIV2MessageChannelEnvelope['type'],
    'surface.context' | 'binding.result' | 'binding.error' | 'connection.changed' | 'theme.changed' | 'access.revoked'>;
  payload: Record<string, unknown>;
};

const identifierPattern = /^[A-Za-z0-9_-]{8,128}$/;
const sessionPattern = /^[A-Za-z0-9_-]{22,128}$/;
const bindingPattern = /^[a-z][a-z0-9-]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function serializedBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? Number.POSITIVE_INFINITY : new TextEncoder().encode(serialized).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function validMetadata(value: unknown): value is Record<string, string | number | boolean | null> {
  return isRecord(value)
    && Object.keys(value).length <= 16
    && Object.entries(value).every(([key, item]) => (
      /^[A-Za-z0-9_.:-]{1,80}$/.test(key)
      && (item === null || ['string', 'number', 'boolean'].includes(typeof item))
    ));
}

/** Parse a request received only on the transferred, per-instance MessagePort. */
export function parseSandboxBridgeRequest(
  value: unknown,
  expectedSessionId: string,
): SandboxBridgeRequest | undefined {
  if (!isRecord(value) || serializedBytes(value) > SANDBOX_BRIDGE_LIMITS.messageBytes) return undefined;
  const allowed = new Set(['bridgeVersion', 'sessionId', 'messageId', 'replyTo', 'type', 'payload']);
  if (Object.keys(value).some((key) => !allowed.has(key))) return undefined;
  if (
    value.bridgeVersion !== NAD_UI_BRIDGE_VERSION
    || value.sessionId !== expectedSessionId
    || !sessionPattern.test(expectedSessionId)
    || typeof value.messageId !== 'string'
    || !identifierPattern.test(value.messageId)
    || (value.replyTo !== undefined && (typeof value.replyTo !== 'string' || !identifierPattern.test(value.replyTo)))
    || !isRecord(value.payload)
  ) return undefined;

  const envelope: BridgeBase = {
    bridgeVersion: NAD_UI_BRIDGE_VERSION,
    sessionId: expectedSessionId,
    messageId: value.messageId,
    ...(typeof value.replyTo === 'string' ? { replyTo: value.replyTo } : {}),
  };
  if (value.type === 'surface.ready') {
    return Object.keys(value.payload).length === 0 ? { ...envelope, type: value.type, payload: {} } : undefined;
  }
  if (value.type === 'binding.invoke') {
    if (typeof value.payload.binding !== 'string' || !bindingPattern.test(value.payload.binding)) return undefined;
    return {
      ...envelope,
      type: value.type,
      payload: {
        binding: value.payload.binding,
        ...('input' in value.payload ? { input: value.payload.input } : {}),
      },
    };
  }
  if (value.type === 'resize.request') {
    if (!Number.isInteger(value.payload.height)) return undefined;
    const height = value.payload.height as number;
    const width = value.payload.width;
    if (
      height < SANDBOX_BRIDGE_LIMITS.minimumHeight
      || height > SANDBOX_BRIDGE_LIMITS.maximumHeight
      || (width !== undefined && (!Number.isInteger(width) || Number(width) < 1 || Number(width) > 8_192))
    ) return undefined;
    return { ...envelope, type: value.type, payload: { ...(width === undefined ? {} : { width: Number(width) }), height } };
  }
  if (value.type === 'navigation.request') {
    const path = value.payload.path;
    if (typeof path !== 'string' || path.length > SANDBOX_BRIDGE_LIMITS.navigationPathLength || !/^\/[a-z0-9/-]*$/.test(path)) return undefined;
    return { ...envelope, type: value.type, payload: { path } };
  }
  if (value.type === 'connection.select.request') {
    if (typeof value.payload.slot !== 'string' || !bindingPattern.test(value.payload.slot)) return undefined;
    return { ...envelope, type: value.type, payload: { slot: value.payload.slot } };
  }
  if (value.type === 'diagnostic.emit') {
    const { level, code, message, metadata } = value.payload;
    if (!['debug', 'info', 'warning', 'error'].includes(String(level))) return undefined;
    if (
      typeof code !== 'string'
      || !/^[A-Z][A-Z0-9_]{0,79}$/.test(code)
      || typeof message !== 'string'
      || message.length === 0
      || message.length > SANDBOX_BRIDGE_LIMITS.diagnosticMessageLength
      || (metadata !== undefined && !validMetadata(metadata))
    ) return undefined;
    return {
      ...envelope,
      type: value.type,
      payload: {
        level: level as 'debug' | 'info' | 'warning' | 'error',
        code,
        message,
        ...(metadata === undefined ? {} : { metadata }),
      },
    };
  }
  return undefined;
}

export function createSandboxDocument(html: string): string {
  if (new TextEncoder().encode(html).length > 512 * 1024) {
    throw new Error('Sandboxed surface HTML exceeds the render limit.');
  }
  const pluginPolicy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data:',
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const pluginDocument = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${pluginPolicy}">${html}`;
  const encodedPluginDocument = encodeURIComponent(pluginDocument);
  // The outer document is core-owned and receives the parent MessagePort. The
  // package runs one level deeper. `frame-src blob:` permits only its embedded
  // initial document, so a package cannot exfiltrate a binding result by
  // navigating its own frame to an HTTP(S) URL (navigation is not governed by
  // connect-src, and CSP navigate-to is not implemented by major browsers).
  const outerPolicy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    'frame-src blob:',
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${outerPolicy}">
<style>html,body,#nad-surface{box-sizing:border-box;width:100%;height:100%;margin:0;border:0;background:transparent}#nad-failure{display:grid;min-height:160px;place-items:center;padding:16px;color:GrayText;font:14px/1.45 system-ui,sans-serif;text-align:center}#nad-failure[hidden]{display:none}</style></head>
<body><iframe id="nad-surface" title="Plugin surface" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><p id="nad-failure" hidden>The isolated surface stopped after an unsafe navigation.</p>
<script>(()=>{const frame=document.getElementById('nad-surface');const failure=document.getElementById('nad-failure');const source=decodeURIComponent(${JSON.stringify(encodedPluginDocument)});let objectUrl=URL.createObjectURL(new Blob([source],{type:'text/html'}));let loadCount=0;let ready=false;let pending=null;let port=null;const revoke=()=>{if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=''}};const fail=()=>{revoke();try{port?.close()}catch{}port=null;pending=null;frame.remove();failure.hidden=false};const forward=()=>{if(!ready||!pending)return;port=pending.port;const message=pending.message;pending=null;try{frame.contentWindow.postMessage(message,'*',[port])}catch{fail()}};frame.addEventListener('load',()=>{loadCount+=1;if(loadCount>1){fail();return}revoke();ready=true;forward()});addEventListener('message',(event)=>{const value=event.data;if(event.source!==parent||pending||port||event.ports.length!==1||!value||value.type!=='nad.ui.connect'||value.bridgeVersion!==2||typeof value.sessionId!=='string'||!/^[A-Za-z0-9_-]{22,128}$/.test(value.sessionId))return;pending={message:value,port:event.ports[0]};forward()});frame.src=objectUrl})();</script></body></html>`;
}
