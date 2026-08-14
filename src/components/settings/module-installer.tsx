'use client';

import { useRef, useState } from 'react';
import { ShieldCheck, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ModuleInstallReviewDetails } from '@/components/settings/module-install-review';
import type { ModuleInstallReview } from '@/lib/modules/installed/install-review-types';

export function ModuleInstaller(): React.JSX.Element {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<{ file: File; review: ModuleInstallReview } | null>(null);

  async function submit(file: File, review?: ModuleInstallReview): Promise<void> {
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const body = new FormData();
      body.set('module', file);
      if (review) {
        body.set('confirm', 'true');
        body.set('expectedDigest', review.digest);
      }
      const response = await fetch('/api/settings/modules/install', { method: 'POST', body });
      const result = await response.json() as {
        data?: { review?: ModuleInstallReview; slug?: string; version?: string; enabled?: boolean };
        error?: string;
      };
      if (!response.ok || !result.data) throw new Error(result.error ?? 'The plugin could not be verified.');
      if (!review && result.data.review) {
        setCandidate({ file, review: result.data.review });
        return;
      }
      if (!result.data.slug || !result.data.version) throw new Error('The plugin install response was incomplete.');
      setMessage(`${result.data.slug} ${result.data.version} installed${result.data.enabled ? ' and kept enabled' : '. Review its settings, then enable it'}.`);
      setCandidate(null);
      if (inputRef.current) inputRef.current.value = '';
      router.refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The plugin could not be installed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card/35">
      <div className="p-4 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-5">
        <div>
          <h3 className="text-sm font-medium">Install from file</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            Upload a signed .nadmod plugin file. NAD verifies it first and asks you to review its access before installation.
          </p>
          {message ? <p className="mt-2 text-xs text-primary" role="status">{message}</p> : null}
          {error ? <p className="mt-2 text-xs text-destructive" role="alert">{error}</p> : null}
        </div>
        <div className="mt-4 shrink-0 sm:mt-0">
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            aria-label="Choose a signed .nadmod plugin file"
            accept=".nadmod,application/zip"
            disabled={pending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void submit(file);
            }}
          />
          <Button variant="outline" disabled={pending} onClick={() => inputRef.current?.click()}>
            <Upload data-icon="inline-start" aria-hidden="true" />
            {pending && !candidate ? 'Verifying…' : 'Choose .nadmod'}
          </Button>
        </div>
      </div>
      {candidate ? (
        <div className="border-t border-border/60 p-5" role="region" aria-label="Plugin install review">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <h4 className="text-sm font-medium">Review {candidate.review.operation}: {candidate.review.name} {candidate.review.version}</h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {candidate.review.publisher} · {candidate.review.signatureStatus === 'verified' ? `Signed by ${candidate.review.signerKeyId}` : 'Unsigned development package'} · Core {candidate.review.compatibility.core}
              </p>
              {candidate.review.currentVersion ? <p className="mt-1 text-xs text-muted-foreground">Current version: {candidate.review.currentVersion}</p> : null}
            </div>
          </div>
          <ModuleInstallReviewDetails review={candidate.review} />
          <p className="mt-3 break-all text-[11px] text-muted-foreground">SHA-256 {candidate.review.digest}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => void submit(candidate.file, candidate.review)}>
              {pending ? 'Installing…' : candidate.review.operation === 'update' ? 'Approve update' : 'Approve install'}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setCandidate(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
