import { cn } from '@/lib/utils';

export function Badge({
  children,
  className,
  variant = 'secondary',
}: {
  children: React.ReactNode;
  className?: string;
  variant?: 'secondary' | 'outline' | 'destructive' | 'success' | 'warning' | 'info';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        variant === 'secondary' && 'bg-secondary text-secondary-foreground',
        variant === 'outline' && 'border border-input bg-background',
        variant === 'destructive' && 'bg-destructive/10 text-destructive',
        variant === 'success' && 'bg-emerald-50 text-emerald-800',
        variant === 'warning' && 'bg-amber-50 text-amber-900',
        variant === 'info' && 'bg-sky-50 text-sky-900',
        className,
      )}
    >
      {children}
    </span>
  );
}
