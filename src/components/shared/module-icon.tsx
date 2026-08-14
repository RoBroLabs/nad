import {
  Activity,
  Box,
  Container,
  Film,
  Gamepad2,
  Network,
  Server,
  ServerCog,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

const moduleIcons: Record<string, LucideIcon> = {
  activity: Activity,
  box: Box,
  container: Container,
  film: Film,
  'gamepad-2': Gamepad2,
  network: Network,
  server: Server,
  'server-cog': ServerCog,
  wrench: Wrench,
};

export function ModuleIcon({ name, className }: { name: string; className?: string }): React.JSX.Element {
  const Icon = moduleIcons[name] ?? Box;
  return <Icon className={className} aria-hidden="true" />;
}
