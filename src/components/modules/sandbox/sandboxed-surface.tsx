'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Link2, ShieldCheck } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createSandboxDocument,
  NAD_UI_BRIDGE_VERSION,
  parseSandboxBridgeRequest,
  SANDBOX_BRIDGE_LIMITS,
  type SandboxBridgeResponse,
  type SandboxConnectionSummary,
  type SandboxSurfaceContext,
} from '@/lib/modules/sandbox-bridge';

export interface SandboxConnectionSlot {
  slot: string;
  label: string;
  required: boolean;
  profiles: SandboxConnectionSummary[];
  selectedProfileId: string | null;
}

export function SandboxedSurface({
  moduleSlug,
  surfaceId,
  title,
  html,
  bindings,
  connectionSlots,
  initialHeight = 420,
  onConnectionChange,
}: {
  moduleSlug: string;
  surfaceId: string;
  title: string;
  html: string;
  bindings: string[];
  connectionSlots: SandboxConnectionSlot[];
  initialHeight?: number;
  onConnectionChange?: (slot: string, profileId: string) => void;
}): React.JSX.Element {
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<MessagePort | null>(null);
  const sessionIdRef = useRef<string>('');
  const requestTimesRef = useRef<number[]>([]);
  const pendingRef = useRef(0);
  const loadedRef = useRef(false);
  const [height, setHeight] = useState(Math.min(
    SANDBOX_BRIDGE_LIMITS.maximumHeight,
    Math.max(SANDBOX_BRIDGE_LIMITS.minimumHeight, initialHeight),
  ));
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedProfiles, setSelectedProfiles] = useState<Record<string, string | null>>(
    Object.fromEntries(connectionSlots.map(({ slot, selectedProfileId }) => [slot, selectedProfileId])),
  );
  const selectedProfilesRef = useRef(selectedProfiles);
  const sandboxDocument = useMemo(() => createSandboxDocument(html), [html]);

  useEffect(() => () => portRef.current?.close(), []);

  function surfaceContext(): SandboxSurfaceContext {
    const theme = document.documentElement.classList.contains('light') ? 'light' : 'dark';
    return {
      moduleSlug,
      surfaceId,
      bindings,
      connectionSlots: connectionSlots.map(({ slot, profiles }) => ({
        slot,
        profiles,
        selectedProfileId: selectedProfilesRef.current[slot] ?? null,
      })),
      theme,
    };
  }

  function send(message: SandboxBridgeResponse): void {
    portRef.current?.postMessage(message);
  }

  function sendError(messageId: string, code: string, message: string): void {
    send({
      bridgeVersion: NAD_UI_BRIDGE_VERSION,
      sessionId: sessionIdRef.current,
      messageId: crypto.randomUUID(),
      replyTo: messageId,
      type: 'binding.error',
      payload: { code, message },
    });
  }

  function allowedByRateLimit(): boolean {
    const cutoff = Date.now() - 60_000;
    requestTimesRef.current = requestTimesRef.current.filter((timestamp) => timestamp >= cutoff);
    if (requestTimesRef.current.length >= SANDBOX_BRIDGE_LIMITS.requestsPerMinute) return false;
    requestTimesRef.current.push(Date.now());
    return true;
  }

  async function invokeBinding(messageId: string, binding: string, input: unknown): Promise<void> {
    if (!bindings.includes(binding)) {
      sendError(messageId, 'BINDING_NOT_DECLARED', 'This surface did not declare that binding.');
      return;
    }
    if (pendingRef.current >= SANDBOX_BRIDGE_LIMITS.pendingRequests) {
      sendError(messageId, 'BRIDGE_BUSY', 'This surface has too many pending requests.');
      return;
    }
    pendingRef.current += 1;
    try {
      const response = await fetch(
        `/api/modules/${encodeURIComponent(moduleSlug)}/surfaces/${encodeURIComponent(surfaceId)}/bindings/${encodeURIComponent(binding)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input, connectionBindings: selectedProfilesRef.current }),
        },
      );
      const result = await response.json() as { data?: unknown; error?: string; code?: string };
      if (!response.ok) {
        sendError(messageId, result.code ?? 'BINDING_FAILED', result.error ?? 'The App operation failed.');
        return;
      }
      send({
        bridgeVersion: NAD_UI_BRIDGE_VERSION,
        sessionId: sessionIdRef.current,
        messageId: crypto.randomUUID(),
        replyTo: messageId,
        type: 'binding.result',
        payload: { binding, result: result.data },
      });
    } catch {
      sendError(messageId, 'BINDING_UNAVAILABLE', 'The App operation could not be reached.');
    } finally {
      pendingRef.current = Math.max(0, pendingRef.current - 1);
    }
  }

  async function emitDiagnostic(
    payload: { level: string; code: string; message: string; metadata?: unknown },
  ): Promise<void> {
    try {
      const response = await fetch(
        `/api/modules/${encodeURIComponent(moduleSlug)}/surfaces/${encodeURIComponent(surfaceId)}/diagnostics`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      // Diagnostics are deliberately fire-and-forget. They do not have a
      // bridge response type and must never become a data channel.
      if (!response.ok) return;
    } catch {}
  }

  function connectBridge(): void {
    if (loadedRef.current) {
      portRef.current?.close();
      portRef.current = null;
      setStatus('error');
      return;
    }
    loadedRef.current = true;
    portRef.current?.close();
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow) return;
    const sessionId = crypto.randomUUID();
    const channel = new MessageChannel();
    sessionIdRef.current = sessionId;
    portRef.current = channel.port1;
    requestTimesRef.current = [];
    pendingRef.current = 0;
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const request = parseSandboxBridgeRequest(event.data, sessionId);
      if (!request) return;
      if (!allowedByRateLimit()) {
        sendError(request.messageId, 'BRIDGE_RATE_LIMIT', 'This surface sent too many requests.');
        return;
      }
      if (request.type === 'surface.ready') {
        setStatus('ready');
        send({
          bridgeVersion: NAD_UI_BRIDGE_VERSION,
          sessionId,
          messageId: crypto.randomUUID(),
          replyTo: request.messageId,
          type: 'surface.context',
          payload: { ...surfaceContext() },
        });
        return;
      }
      if (request.type === 'binding.invoke') {
        void invokeBinding(request.messageId, request.payload.binding, request.payload.input);
        return;
      }
      if (request.type === 'resize.request') {
        setHeight(request.payload.height);
        return;
      }
      if (request.type === 'navigation.request') {
        router.push(request.payload.path);
        return;
      }
      if (request.type === 'connection.select.request') {
        const slot = connectionSlots.find(({ slot: candidate }) => candidate === request.payload.slot);
        if (!slot) sendError(request.messageId, 'CONNECTION_SLOT_UNKNOWN', 'That connection slot is not declared.');
        else send({
          bridgeVersion: NAD_UI_BRIDGE_VERSION,
          sessionId,
          messageId: crypto.randomUUID(),
          replyTo: request.messageId,
          type: 'surface.context',
          payload: { ...surfaceContext() },
        });
        return;
      }
      void emitDiagnostic(request.payload);
    };
    channel.port1.start();
    frameWindow.postMessage({
      type: 'nad.ui.connect',
      bridgeVersion: NAD_UI_BRIDGE_VERSION,
      sessionId,
    }, '*', [channel.port2]);
  }

  function updateConnection(slot: string, profileId: string): void {
    const next = { ...selectedProfilesRef.current, [slot]: profileId };
    selectedProfilesRef.current = next;
    setSelectedProfiles(next);
    onConnectionChange?.(slot, profileId);
    if (sessionIdRef.current) {
      send({
        bridgeVersion: NAD_UI_BRIDGE_VERSION,
        sessionId: sessionIdRef.current,
        messageId: crypto.randomUUID(),
        type: 'connection.changed',
        payload: { slot, profileId },
      });
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card/35">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium">{title}</h2>
            <p className="text-xs text-muted-foreground">Isolated plugin surface</p>
          </div>
        </div>
        {connectionSlots.length ? (
          <div className="flex flex-wrap items-end gap-2">
            {connectionSlots.map((slot) => (
              <div key={slot.slot} className="space-y-1">
                <Label htmlFor={`${surfaceId}-${slot.slot}`} className="text-[11px] text-muted-foreground">
                  {slot.label}
                </Label>
                <Select
                  value={selectedProfiles[slot.slot] ?? undefined}
                  onValueChange={(value) => updateConnection(slot.slot, value)}
                >
                  <SelectTrigger id={`${surfaceId}-${slot.slot}`} className="h-8 min-w-36 text-xs">
                    <Link2 className="size-3.5" aria-hidden="true" />
                    <SelectValue placeholder={slot.required ? 'Choose connection' : 'No connection'} />
                  </SelectTrigger>
                  <SelectContent>
                    {slot.profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        ) : null}
      </header>
      {connectionSlots.some((slot) => slot.required && !selectedProfiles[slot.slot]) ? (
        <div className="flex min-h-48 items-center justify-center gap-2 px-5 text-center text-sm text-muted-foreground">
          <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
          Choose the required connection to start this surface.
        </div>
      ) : (
        <div className="relative bg-background/35">
          {status === 'loading' ? (
            <p className="absolute inset-x-0 top-4 z-10 text-center text-xs text-muted-foreground" role="status">
              Starting isolated surface…
            </p>
          ) : null}
          {status === 'error' ? (
            <div className="flex min-h-48 items-center justify-center gap-2 px-5 text-center text-sm text-muted-foreground" role="alert">
              <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
              The isolated surface navigated away or did not start safely.
            </div>
          ) : <iframe
            ref={iframeRef}
            title={title}
            sandbox="allow-scripts"
            srcDoc={sandboxDocument}
            className="block w-full border-0 bg-transparent"
            style={{ height }}
            referrerPolicy="no-referrer"
            onLoad={connectBridge}
            onError={() => setStatus('error')}
          />}
        </div>
      )}
    </section>
  );
}
