import Image from 'next/image';

type LogoProps = {
  className?: string;
  alt?: string;
  width?: number;
  height?: number;
  priority?: boolean;
  iconOnly?: boolean;
};

export function Logo({
  className,
  alt = 'Lextopus',
  width = 160,
  height = 48,
  priority = false,
  iconOnly = true,
}: LogoProps) {
  return (
    <Image
      src="/brand/lextopus.svg"
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      style={
        iconOnly
          ? {
              clipPath: 'inset(0 0 14% 0)',
              transform: 'translateY(-6%)',
            }
          : undefined
      }
      className={className}
    />
  );
}
