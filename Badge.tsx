import React from 'react';
import './Badge.css';

type BadgeVariant = 'success' | 'danger' | 'warning' | 'default';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  className = '',
}) => {
  const badgeClasses = `badge badge--${variant} ${className}`;
  return <span className={badgeClasses}>{children}</span>;
};

export default Badge;