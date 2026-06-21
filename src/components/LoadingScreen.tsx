/**
 * Loading Screen Component
 * 
 * Full-screen loading indicator.
 */

import { cn } from '../lib/utils';

interface LoadingScreenProps {
  message?: string;
  className?: string;
}

export default function LoadingScreen({ 
  message = 'Loading...', 
  className 
}: LoadingScreenProps) {
  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex flex-col items-center justify-center',
        'bg-white dark:bg-secondary-900',
        className
      )}
    >
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-200 border-t-primary-600 mb-4" />
      <p className="text-secondary-600 dark:text-secondary-400 animate-pulse-slow">
        {message}
      </p>
    </div>
  );
}