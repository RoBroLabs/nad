'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronRight, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ModuleIcon } from '@/components/shared/module-icon';
import type { ModuleCategory, ModuleStatus } from '@/lib/modules/types';
import { moduleStatusLabel } from '@/lib/modules/status';
import { requestApi } from '@/lib/client-api';

export interface ModuleListItem {
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: ModuleCategory;
  status: ModuleStatus;
  version: string;
  publisher?: string;
}

export function ModuleList({ modules }: { modules: ModuleListItem[] }): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function setEnabled(module: ModuleListItem, enabled: boolean): Promise<void> {
    setError(null);
    setPending((current) => new Set(current).add(module.slug));
    try {
      await requestApi<{ enabled: boolean }>(`/api/settings/modules/${module.slug}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }, `${module.name} could not be ${enabled ? 'enabled' : 'disabled'}.`);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The plugin could not be updated.');
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(module.slug);
        return next;
      });
    }
  }

  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card/35">
        {modules.length === 0 ? (
          <div className="px-5 py-8">
            <p className="text-sm font-medium">No plugins installed</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Browse the Marketplace or upload a signed .nadmod file to add your first plugin.
            </p>
          </div>
        ) : modules.map((module, index) => (
          <div
            key={module.slug}
            className="group relative flex items-center gap-4 px-4 py-4 transition-colors hover:bg-accent/35 sm:px-5"
          >
            {index > 0 ? <span className="absolute inset-x-5 top-0 border-t border-border/60" /> : null}
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground ring-1 ring-border/70">
              <ModuleIcon name={module.icon} className="size-5" />
            </span>
            <Link href={`/settings/modules/${module.slug}`} className="min-w-0 flex-1 after:absolute after:inset-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{module.name}</span>
                <Badge variant="outline" className="capitalize">{module.category}</Badge>
                <Badge
                  variant="secondary"
                  className="font-normal"
                >
                  {moduleStatusLabel(module.status)}
                </Badge>
                <Badge variant="outline" className="font-normal">
                  Installed · {module.version}
                </Badge>
                {module.status === 'quarantined' ? (
                  <Badge variant="destructive" className="gap-1 font-normal">
                    <ShieldAlert className="size-3" aria-hidden="true" />
                    Execution blocked
                  </Badge>
                ) : null}
              </span>
              <span className="mt-1 block truncate text-sm text-muted-foreground">
                {module.description}{module.publisher ? ` · ${module.publisher}` : ''}
              </span>
            </Link>
            <div className="relative z-10 flex items-center gap-3">
              <Switch
                checked={module.status !== 'discovered' && module.status !== 'quarantined'}
                disabled={pending.has(module.slug) || module.status === 'quarantined'}
                onCheckedChange={(checked) => setEnabled(module, checked)}
                aria-label={`${module.status === 'discovered' ? 'Enable' : 'Disable'} ${module.name}`}
              />
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
