'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import {
  SandboxedSurface,
  type SandboxConnectionSlot,
} from '@/components/modules/sandbox/sandboxed-surface';

interface SurfaceContext {
  html: string;
  digest: string;
  releaseId: string;
  bindings: string[];
  connectionSlots: SandboxConnectionSlot[];
}

function validContext(value: unknown): value is SurfaceContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  return typeof context.html === 'string'
    && typeof context.digest === 'string'
    && typeof context.releaseId === 'string'
    && Array.isArray(context.bindings)
    && Array.isArray(context.connectionSlots);
}

export function InstalledSandboxSurface({
  moduleSlug,
  surfaceId,
  title,
  connectionProfileId,
  initialHeight,
  onPrimaryConnectionChange,
  persistConnectionEndpoint,
}: {
  moduleSlug: string;
  surfaceId: string;
  title: string;
  connectionProfileId?: string | null;
  initialHeight?: number;
  onPrimaryConnectionChange?: (profileId: string) => void;
  persistConnectionEndpoint?: string;
}): React.JSX.Element {
  const [context, setContext] = useState<SurfaceContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionSaveError, setConnectionSaveError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setContext(null);
    setError(null);
    void fetch(
      `/api/modules/${encodeURIComponent(moduleSlug)}/surfaces/${encodeURIComponent(surfaceId)}`,
      { cache: 'no-store', signal: controller.signal },
    )
      .then(async (response) => {
        const payload = await response.json() as { data?: unknown; error?: string };
        if (!response.ok || !validContext(payload.data)) {
          throw new Error(payload.error ?? 'The isolated surface could not be loaded.');
        }
        const data = payload.data;
        const connectionSlots = data.connectionSlots.map((slot, index) => {
          const selectedProfileId = index === 0
            && connectionProfileId
            && slot.profiles.some(({ id }) => id === connectionProfileId)
            ? connectionProfileId
            : slot.selectedProfileId;
          return { ...slot, selectedProfileId };
        });
        setContext({ ...data, connectionSlots });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'The isolated surface could not be loaded.');
      });
    return () => controller.abort();
  }, [connectionProfileId, moduleSlug, surfaceId]);

  if (error) {
    return (
      <div className="flex min-h-40 items-center justify-center gap-2 px-5 text-center text-sm text-muted-foreground" role="alert">
        <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />
        {error}
      </div>
    );
  }
  if (!context) {
    return (
      <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        Loading isolated surface…
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {connectionSaveError ? (
        <p role="alert" className="flex items-center gap-2 border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="size-3.5" aria-hidden="true" />{connectionSaveError}
        </p>
      ) : null}
      <SandboxedSurface
      moduleSlug={moduleSlug}
      surfaceId={surfaceId}
      title={title}
      html={context.html}
      bindings={context.bindings}
      connectionSlots={context.connectionSlots}
      initialHeight={initialHeight}
      onConnectionChange={(slot, profileId) => {
        if (slot !== context.connectionSlots[0]?.slot) return;
        onPrimaryConnectionChange?.(profileId);
        if (persistConnectionEndpoint) {
          setConnectionSaveError(null);
          void fetch(persistConnectionEndpoint, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ connectionProfileId: profileId }),
          }).then((response) => {
            if (!response.ok) setConnectionSaveError('The selected connection could not be saved to this Workspace.');
          }).catch(() => setConnectionSaveError('The selected connection could not be saved to this Workspace.'));
        }
      }}
      />
    </div>
  );
}
