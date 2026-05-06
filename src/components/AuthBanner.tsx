import { useNavigate } from 'react-router-dom';
import { useAuthBanner } from '@/contexts/AuthBannerContextStore';
import { useAuth } from '@/context/AuthProvider';
import { Button } from '@/components/ui/button';
import { AlertTriangle, X } from 'lucide-react';
import { useEffect } from 'react';

export const AuthBanner = () => {
  const { showBanner, hideBanner } = useAuthBanner();
  const { session } = useAuth();
  const navigate = useNavigate();

  // Auto-hide when user logs in
  useEffect(() => {
    if (session && showBanner) {
      hideBanner();
    }
  }, [session, showBanner, hideBanner]);

  if (!showBanner) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-destructive text-destructive-foreground px-4 py-3 shadow-lg">
      <div className="container mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">
            Your session has expired. Please sign in to continue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate('/auth')}
          >
            Sign In
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 hover:bg-destructive-foreground/10"
            onClick={hideBanner}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
