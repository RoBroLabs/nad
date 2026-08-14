import type { InstalledPageView } from '@/lib/modules/types';
import { InstalledDataView } from '@/components/modules/declarative/installed-data-view';

export function InstalledModulePage({
  moduleSlug,
  view,
}: {
  moduleSlug: string;
  view: InstalledPageView;
}): React.JSX.Element {
  return (
    <div className="space-y-5">
      {view.sections.map((section) => (
        <section key={section.id} className="rounded-xl border border-border/70 bg-card/35 p-5">
          <div className="mb-4">
            <h2 className="text-base font-medium">{section.title}</h2>
            {section.description ? <p className="mt-1 text-sm text-muted-foreground">{section.description}</p> : null}
          </div>
          <InstalledDataView moduleSlug={moduleSlug} view={section} />
        </section>
      ))}
    </div>
  );
}
