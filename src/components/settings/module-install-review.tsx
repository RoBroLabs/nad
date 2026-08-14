import React from 'react';
import type {
  ModuleInstallReview,
  ModuleReviewConfigField,
  ModuleReviewHttpAccess,
  ModuleUpdateChanges,
} from '@/lib/modules/installed/install-review-types';

function endpointLabel(scope: ModuleReviewHttpAccess): string {
  const port = typeof scope.port === 'number' ? scope.port : `<${scope.port.label}>`;
  const controls = [
    scope.credential
      ? `core injects ${scope.credential.config.label} into ${scope.credential.location} ${scope.credential.name}`
      : undefined,
    scope.requestBodyPolicy ? `body policy: ${scope.requestBodyPolicy}` : undefined,
    scope.allowedHeaders.length ? `runtime headers: ${scope.allowedHeaders.join(', ')}` : undefined,
    scope.queryParameters.length ? `query keys: ${scope.queryParameters.join(', ')}` : undefined,
    scope.tlsVerification ? `TLS verification follows ${scope.tlsVerification.label}` : undefined,
  ].filter((value): value is string => value !== undefined);
  return `${scope.effect.toUpperCase()} · ${scope.methods.join(', ')} ${scope.scheme}://<${scope.hostConfig.label}>:${port}${scope.path}${controls.length ? ` · ${controls.join(' · ')}` : ''}`;
}

function configLabel(field: ModuleReviewConfigField): string {
  return `${field.label} (${field.type}, ${field.required ? 'required' : 'optional'})`;
}

function changedLabels(changes: ModuleUpdateChanges): string[] {
  return [
    ...changes.capabilities.changed.map(({ before, after }) => `Core service ${after.name}: “${before.reason}” → “${after.reason}”`),
    ...changes.permissions.changed.map(({ before, after }) => `Permission ${after.action}: ${before.label} → ${after.label}`),
    ...changes.configFields.changed.map(({ before, after }) => `Setting ${after.key}: ${configLabel(before)} → ${configLabel(after)}`),
    ...changes.httpAccess.changed.map(({ before, after }) => `Network scope: ${endpointLabel(before)} → ${endpointLabel(after)}`),
  ];
}

function addedLabels(changes: ModuleUpdateChanges): string[] {
  return [
    ...changes.capabilities.added.map(({ name, reason }) => `Core service ${name} — ${reason}`),
    ...changes.permissions.added.map(({ action, description }) => `Permission ${action} — ${description}`),
    ...changes.configFields.added.map((field) => `Setting ${configLabel(field)}`),
    ...changes.httpAccess.added.map((scope) => `Network scope ${endpointLabel(scope)}`),
  ];
}

function removedLabels(changes: ModuleUpdateChanges): string[] {
  return [
    ...changes.capabilities.removed.map(({ name }) => `Core service ${name}`),
    ...changes.permissions.removed.map(({ action }) => `Permission ${action}`),
    ...changes.configFields.removed.map((field) => `Setting ${configLabel(field)}`),
    ...changes.httpAccess.removed.map((scope) => `Network scope ${endpointLabel(scope)}`),
  ];
}

function ChangeList({ title, items, tone }: {
  title: string;
  items: string[];
  tone: 'added' | 'removed' | 'changed';
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  const toneClass = tone === 'added'
    ? 'border-amber-500/35 bg-amber-500/5'
    : tone === 'removed'
      ? 'border-border/70 bg-muted/25'
      : 'border-primary/25 bg-primary/5';
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="font-medium">{title}</p>
      <ul className="mt-1 space-y-1 text-muted-foreground">
        {items.map((item) => <li key={item}>• {item}</li>)}
      </ul>
    </div>
  );
}

function UpdateChanges({ review }: { review: ModuleInstallReview }): React.JSX.Element | null {
  if (!review.changes) return null;
  const added = addedLabels(review.changes);
  const removed = removedLabels(review.changes);
  const changed = changedLabels(review.changes);
  const hasDeclarationChanges = added.length + removed.length + changed.length > 0;
  return (
    <section className="mt-4 rounded-lg border border-border/70 p-3" aria-labelledby={`update-changes-${review.slug}`}>
      <h5 id={`update-changes-${review.slug}`} className="font-medium">
        Changes from {review.currentVersion} to {review.version}
      </h5>
      <div className="mt-2 grid gap-2">
        <ChangeList title="New plugin access or settings" items={added} tone="added" />
        <ChangeList title="Removed plugin access or settings" items={removed} tone="removed" />
        <ChangeList title="Changed declarations" items={changed} tone="changed" />
        {!hasDeclarationChanges ? <p className="text-muted-foreground">No access, configuration or network declarations change.</p> : null}
      </div>
      <p className="mt-3 text-muted-foreground">
        <span className="font-medium text-foreground">Data migration:</span> {review.changes.dataMigration.summary}
      </p>
    </section>
  );
}

export function ModuleInstallReviewDetails({ review }: { review: ModuleInstallReview }): React.JSX.Element {
  return (
    <>
      <UpdateChanges review={review} />
      <div className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
        <div>
          <p className="font-medium">Core services this plugin can use</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {review.capabilities.map(({ name, reason }) => <li key={name}><code>{name}</code> — {reason}</li>)}
          </ul>
        </div>
        <div>
          <p className="font-medium">User permissions this plugin adds</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {review.permissions.map(({ action, description }) => <li key={action}><code>{action}</code> — {description}</li>)}
          </ul>
        </div>
        <div>
          <span className="font-medium">Network target settings:</span>{' '}
          <span className="text-muted-foreground">{review.networkConfigFields.map(({ label }) => label).join(', ') || 'none'}</span>
        </div>
        <div>
          <span className="font-medium">Secret settings:</span>{' '}
          <span className="text-muted-foreground">{review.secretConfigFields.map(({ label }) => label).join(', ') || 'none'}</span>
        </div>
        {review.httpAccess.length ? (
          <div className="sm:col-span-2">
            <p className="font-medium">Approved network endpoints for this plugin</p>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {review.httpAccess.map((scope) => <li key={endpointLabel(scope)}><code>{endpointLabel(scope)}</code></li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </>
  );
}
