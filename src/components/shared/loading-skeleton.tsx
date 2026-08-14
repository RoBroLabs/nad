import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function LoadingSkeleton({ className }: { className?: string }): React.JSX.Element {
  return (
    <div className={cn('glass-subtle space-y-5 rounded-2xl p-6', className)} aria-label="Loading">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-44 w-full rounded-xl" />
    </div>
  );
}
