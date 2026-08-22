'use client';

import { Boxes } from 'lucide-react';
import type { InstalledUiElement, InstalledDataView } from '@/lib/modules/types';
import {
  DataTable,
  KeyValueList,
  MetricCell,
  MetricGroup,
  StatusCell,
} from '@/components/modules/declarative/primitives';

/**
 * A shape-accurate preview of a Widget, drawn from what its package declares.
 *
 * This deliberately does not call the plugin's endpoint. Opening the picker
 * would otherwise fan out a request per Widget, and an unconfigured or
 * unreachable host would fill the dialog with errors. The preview shows the
 * layout a Widget produces, with stand-in values, so the choice is a visual
 * one rather than a guess from a name.
 */

const sampleWords = ['online', 'healthy', 'active'];
const sampleNames = ['host-01', 'media-01', 'backup-01'];
const sampleCounts = [12, 47, 128];

/**
 * Stand-in values chosen from the declared label, so a preview reads as
 * plausible rather than as a row of arbitrary numbers. Matched most-specific
 * first: `Disk used` is a size, not a status, even though both words appear.
 */
function sampleFor(label: string, unit: string | undefined, index: number): unknown {
  if (unit === '%') return [24, 61, 8, 47][index % 4];
  if (/uptime|since|age|last|ago/i.test(label)) return '4 days';
  if (/used|free|size|capacity|total|space/i.test(label)) return [128, 512, 1024][index % 3];
  if (/status|state|health|parity/i.test(label)) return sampleWords[index % sampleWords.length];
  if (/name|host|node|server|guest|vm|container|device|client/i.test(label)) {
    return sampleNames[index % sampleNames.length];
  }
  return sampleCounts[index % sampleCounts.length];
}

type MeasureElement = Extract<InstalledUiElement, { type: 'metric' | 'status' }>;
type StandaloneElement = Exclude<InstalledUiElement, MeasureElement>;
type PreviewRun = { measures: MeasureElement[] } | { other: StandaloneElement };

function PreviewElements({ elements }: { elements: InstalledUiElement[] }): React.JSX.Element {
  const runs: PreviewRun[] = [];
  for (const element of elements) {
    if (element.type === 'metric' || element.type === 'status') {
      const last = runs[runs.length - 1];
      if (last && 'measures' in last) last.measures.push(element);
      else runs.push({ measures: [element] });
    } else {
      runs.push({ other: element });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {runs.map((run, runIndex) => {
        if ('measures' in run) {
          return (
            <MetricGroup key={runIndex} compact>
              {run.measures.slice(0, 3).map((element, index) => element.type === 'status' ? (
                <StatusCell
                  key={index}
                  label={element.label}
                  value={sampleWords[index % sampleWords.length]}
                  tone="success"
                />
              ) : (
                <MetricCell
                  key={index}
                  compact
                  label={element.label}
                  value={sampleFor(element.label, element.unit, index)}
                  unit={element.unit}
                  tone={null}
                />
              ))}
            </MetricGroup>
          );
        }

        const element = run.other;
        if (element.type === 'section') {
          return <PreviewElements key={runIndex} elements={element.body} />;
        }
        if (element.type === 'text') {
          return (
            <p key={runIndex} className="text-xs leading-5 text-muted-foreground">
              {element.value ?? 'Text from the plugin appears here.'}
            </p>
          );
        }
        if (element.type === 'keyValue') {
          return (
            <KeyValueList
              key={runIndex}
              columns={1}
              items={element.items.slice(0, 3).map((item, index) => ({
                label: item.label,
                value: sampleFor(item.label, item.unit, index),
                unit: item.unit,
              }))}
            />
          );
        }
        return (
          <DataTable
            key={runIndex}
            compact
            columns={element.columns.slice(0, 3).map((column) => ({ key: column.key, label: column.label }))}
            rows={[0, 1].map((row) => element.columns.slice(0, 3).map((column) => ({
              key: column.key,
              value: sampleFor(column.label, undefined, row),
            })))}
          />
        );
      })}
    </div>
  );
}

export function WidgetPreview({
  installedView,
  isSandbox,
}: {
  installedView?: InstalledDataView;
  isSandbox?: boolean;
}): React.JSX.Element {
  if (isSandbox) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Boxes className="size-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-xs text-muted-foreground">The plugin draws this Widget itself.</p>
      </div>
    );
  }

  if (installedView?.body?.length) {
    return <PreviewElements elements={installedView.body} />;
  }

  // No declared body: the renderer picks a shape from the response at runtime.
  if (installedView?.type === 'table' || installedView?.type === 'status-list') {
    return (
      <DataTable
        compact
        columns={[{ key: 'a', label: 'Name' }, { key: 'b', label: 'Status' }]}
        rows={[
          [{ key: 'a', value: 'host-01' }, { key: 'b', value: 'online' }],
          [{ key: 'a', value: 'host-02' }, { key: 'b', value: 'online' }],
        ]}
      />
    );
  }
  return (
    <KeyValueList
      columns={1}
      items={[
        { label: 'Status', value: 'online' },
        { label: 'Value', value: 42 },
      ]}
    />
  );
}
