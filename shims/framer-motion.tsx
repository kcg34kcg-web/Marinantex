import * as React from 'react';

type AnyProps = { [key: string]: any; children?: React.ReactNode };

const MotionComponent = React.forwardRef<HTMLElement, AnyProps>(({ children, ...props }, ref) => {
  const Comp: any = 'div';
  return (
    <Comp ref={ref} {...props}>
      {children}
    </Comp>
  );
});
MotionComponent.displayName = 'MotionComponent';

export const motion = new Proxy(
  {},
  {
    get: (_target, tag: PropertyKey) => {
      const htmlTag = typeof tag === 'string' ? tag : 'div';
      const Component = React.forwardRef<HTMLElement, AnyProps>(({ children, ...props }, ref) =>
        React.createElement(htmlTag, { ref, ...props }, children),
      );
      Component.displayName = `motion.${String(tag)}`;
      return Component;
    },
  },
) as Record<string, React.ComponentType<any>>;

export function AnimatePresence({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useAnimation() {
  return {
    start: async (_definition?: unknown) => {},
    stop: () => {},
    set: (_definition?: unknown) => {},
  };
}

export function useAnimate() {
  const scope = React.useRef<HTMLElement | null>(null);
  const animate = async (..._args: unknown[]) => ({});
  return [scope, animate] as const;
}

export type AnimationSequence = Array<unknown>;

export default MotionComponent;
