/**
 * Card Component
 * 
 * Reusable card component with consistent styling.
 */

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'danger' | 'success' | 'warning';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hoverable?: boolean;
  clickable?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    { className, variant = 'default', padding = 'md', hoverable = false, clickable = false, ...props },
    ref
  ) => {
    const paddingClasses = {
      none: '',
      sm: 'p-4',
      md: 'p-6',
      lg: 'p-8',
    };

    const variantClasses = {
      default: 'bg-white border-secondary-200',
      primary: 'bg-primary-50 border-primary-200',
      secondary: 'bg-secondary-50 border-secondary-200',
      danger: 'bg-red-50 border-red-200',
      success: 'bg-green-50 border-green-200',
      warning: 'bg-yellow-50 border-yellow-200',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl border shadow-sm transition-all duration-200',
          variantClasses[variant],
          paddingClasses[padding],
          hoverable && 'hover:shadow-md hover:-translate-y-0.5',
          clickable && 'cursor-pointer active:scale-[0.98]',
          className
        )}
        {...props}
      />
    );
  }
);

Card.displayName = 'Card';

export default Card;