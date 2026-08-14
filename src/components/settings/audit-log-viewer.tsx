'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { requestApi } from '@/lib/client-api';

interface AuditLogEntryView {
  id: string;
  userId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  moduleSlug: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

interface AuditLogResponse {
  entries: AuditLogEntryView[];
  total: number;
  page: number;
  pageSize: number;
  modules: Array<{ slug: string; name: string }>;
}

const ALL_MODULES = '__all__';
const PAGE_SIZE = 50;

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function actorLabel(entry: AuditLogEntryView): string {
  if (entry.actorName) return entry.actorName;
  if (entry.userId) return `Deleted user (${entry.userId.slice(0, 8)}…)`;
  return 'System';
}

export function AuditLogViewer(): React.JSX.Element {
  const [moduleFilter, setModuleFilter] = useState<string>(ALL_MODULES);
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['settings', 'audit', moduleFilter, actionFilter, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (moduleFilter !== ALL_MODULES) params.set('module', moduleFilter);
      if (actionFilter.trim()) params.set('action', actionFilter.trim());
      return requestApi<AuditLogResponse>(`/api/settings/audit?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  function updateModuleFilter(value: string): void {
    setModuleFilter(value);
    setPage(1);
  }

  function updateActionFilter(value: string): void {
    setActionFilter(value);
    setPage(1);
  }

  return (
    <Card className="glass-subtle border-border/70">
      <CardHeader className="space-y-1.5">
        <CardTitle className="flex items-center gap-2 text-lg">
          <ScrollText className="size-4 text-primary" aria-hidden="true" />
          Audit log
        </CardTitle>
        <CardDescription className="max-w-2xl leading-6">
          Operational actions recorded by NAD: plugin configuration changes, user administration,
          and plugin actions such as container recreation or DNS blocking. Deleted users keep an
          opaque actor identifier.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="w-full space-y-2 sm:w-56">
            <Label htmlFor="audit-module-filter">Plugin</Label>
            <Select value={moduleFilter} onValueChange={updateModuleFilter}>
              <SelectTrigger id="audit-module-filter" aria-label="Filter by plugin">
                <SelectValue placeholder="All plugins" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_MODULES}>All plugins</SelectItem>
                {(data?.modules ?? []).map(({ slug, name }) => (
                  <SelectItem key={slug} value={slug}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full space-y-2 sm:w-72">
            <Label htmlFor="audit-action-filter">Action</Label>
            <Input
              id="audit-action-filter"
              value={actionFilter}
              onChange={(event) => updateActionFilter(event.target.value)}
              placeholder="e.g. update_module_config"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        {query.isError ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            The audit log could not be loaded.{' '}
            <button type="button" className="rounded-sm font-medium underline outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void query.refetch()}>
              Try again
            </button>
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-border/70" aria-busy={query.isPending}>
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border/70 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-medium">Time</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Actor</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Action</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Plugin</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {query.isPending ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    Loading audit entries…
                  </td>
                </tr>
              ) : null}
              {data && data.entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    No audit entries match these filters.
                  </td>
                </tr>
              ) : null}
              {data?.entries.map((entry) => (
                <tr key={entry.id} className="border-b border-border/50 last:border-0 align-top">
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                    {formatTimestamp(entry.createdAt)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="block">{actorLabel(entry)}</span>
                    {entry.actorEmail ? (
                      <span className="block text-xs text-muted-foreground">{entry.actorEmail}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <code className="text-xs">{entry.action}</code>
                  </td>
                  <td className="px-3 py-2.5">{entry.moduleSlug ?? '—'}</td>
                  <td className="max-w-xs px-3 py-2.5">
                    {entry.details ? (
                      <code className="block truncate text-xs text-muted-foreground" title={JSON.stringify(entry.details)}>
                        {JSON.stringify(entry.details)}
                      </code>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {data ? `${data.total} entr${data.total === 1 ? 'y' : 'ies'} · page ${data.page} of ${totalPages}` : '…'}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || query.isPending}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft data-icon="inline-start" aria-hidden="true" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!data || page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
              <ChevronRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
