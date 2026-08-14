import { cn } from '@/lib/utils';

interface NadLogoProps {
  className?: string;
  title?: string;
}

/** The compact NAD mark used across authentication, navigation, and app icons. */
export function NadLogo({ className, title }: NadLogoProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="nad-logo-gradient" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#38bdf8" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="#080b12" />
      <path d="M16 45V19h7l13 16V19h7v26h-7L23 29v16h-7Z" fill="url(#nad-logo-gradient)" />
      <circle cx="48" cy="20" r="4" fill="#34d399" />
    </svg>
  );
}
