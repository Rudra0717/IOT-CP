import React from 'react';
import clsx from 'clsx';

export type BadgeVariant = 'success' | 'warning' | 'critical' | 'info' | 'muted';

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant, children, className }: BadgeProps) {
  const baseStyle = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium';
  const variantStyles = {
    success: 'bg-green-100/10 text-accent-green border border-accent-green/20',
    warning: 'bg-yellow-100/10 text-accent-yellow border border-accent-yellow/20',
    critical: 'bg-red-100/10 text-accent-red border border-accent-red/20 animate-pulse',
    info: 'bg-blue-100/10 text-accent-blue border border-accent-blue/20',
    muted: 'bg-gray-100/10 text-text-muted border border-gray-500/20',
  };

  return (
    <span className={clsx(baseStyle, variantStyles[variant], className)}>
      {children}
    </span>
  );
}
