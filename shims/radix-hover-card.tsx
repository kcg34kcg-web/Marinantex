import * as React from 'react';

type Props = React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode };
type RootProps = {
  children: React.ReactNode;
  openDelay?: number;
  closeDelay?: number;
};
type TriggerProps = {
  children: React.ReactNode;
  asChild?: boolean;
};
type ContentProps = Props & {
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
};

export function Root({ children }: RootProps) {
  return <>{children}</>;
}

export function Trigger({ children }: TriggerProps) {
  return <>{children}</>;
}

export function Portal({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function Content({ children, className, side, align, sideOffset, ...props }: ContentProps) {
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}

export function Arrow({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 8" className={className} {...props}>
      <path d="M0 8L8 0L16 8Z" />
    </svg>
  );
}

export const HoverCard = Root;
export const HoverCardTrigger = Trigger;
export const HoverCardContent = Content;
