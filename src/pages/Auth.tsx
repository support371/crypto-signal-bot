import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { z } from 'zod';
import { Loader2, TrendingUp, Shield, AlertTriangle } from 'lucide-react';

const authSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

/**
 * Map Supabase auth error messages to user-friendly messages.
 * Uses case-insensitive matching for resilience across Supabase versions.
 */
function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
    return 'Invalid email or password. Please try again.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Please confirm your email before signing in. Check your inbox.';
  }
  if (lower.includes('user already registered') || lower.includes('already exists')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('429')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (lower.includes('password') && lower.includes('weak')) {
    return 'Password is too weak. Please choose a stronger password.';
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('failed to fetch') || lower.includes('load failed')) {
    return 'Network error. Please check your connection and try again.';
  }
  if (lower.includes('signup disabled') || lower.includes('signups not allowed')) {
    return 'Sign up is currently disabled. Please contact support.';
  }

  // Fallback — show the original message
  return message || 'An unexpected error occurred. Please try again.';
}

const Auth = () => {
  const navigate = useNavigate();
  const { user, isLoading: authLoading, signIn, signUp, authUnconfigured, isDemoMode } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  // Redirect if already logged in (including demo mode)
  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  const validateForm = () => {
    const result = authSchema.safeParse({ email, password });
    if (!result.success) {
      const fieldErrors: { email?: string; password?: string } = {};
      result.error.errors.forEach((error) => {
        if (error.path[0] === 'email') {
          fieldErrors.email = error.message;
        } else if (error.path[0] === 'password') {
          fieldErrors.password = error.message;
        }
      });
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      const { error } = await signIn(email, password);
      if (error) {
        toast.error(friendlyAuthError(error.message));
      } else {
        toast.success('Welcome back!');
        navigate('/');
      }
    } catch {
      toast.error('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      const { error } = await signUp(email, password);
      if (error) {
        toast.error(friendlyAuthError(error.message));
      } else {
        toast.success('Account created! Check your email to confirm, then sign in.');
      }
    } catch {
      toast.error('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  // Show configuration error when Supabase is not set up and demo mode is not enabled
  if (authUnconfigured) {
    return (
      <div className="min-h-screen bg-background scanlines flex flex-col items-center justify-center p-4">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <TrendingUp className="h-8 w-8 text-accent" />
            <h1 className="text-2xl font-bold font-mono tracking-wider text-accent">
              CRYPTO RISK AGENT
            </h1>
          </div>
        </div>

        <Card className="w-full max-w-md cyber-card border-warning">
          <CardHeader>
            <CardTitle className="font-mono flex items-center gap-2 text-warning">
              <AlertTriangle className="h-5 w-5" />
              Authentication Not Configured
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Supabase authentication is not configured for this deployment.
            </p>
            <div className="bg-muted/50 p-3 rounded-md font-mono text-xs space-y-1">
              <p className="text-muted-foreground">Required environment variables:</p>
              <p className="text-foreground">VITE_SUPABASE_URL</p>
              <p className="text-foreground">VITE_SUPABASE_PUBLISHABLE_KEY</p>
            </div>
            <p className="text-sm text-muted-foreground">
              To enable demo mode without authentication, set:
            </p>
            <div className="bg-muted/50 p-3 rounded-md font-mono text-xs">
              <p className="text-foreground">VITE_DEMO_MODE=true</p>
            </div>
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button
              variant="outline"
              className="w-full font-mono"
              onClick={() => navigate('/public')}
            >
              View Public Dashboard
            </Button>
            <Button
              variant="outline"
              className="w-full font-mono"
              onClick={() => navigate('/waitlist')}
            >
              Join Waitlist
            </Button>
          </CardFooter>
        </Card>

        <p className="mt-4 text-xs text-muted-foreground font-mono">
          Paper trading only - No real money involved
        </p>
      </div>
    );
  }

  // If in demo mode, user should already be set and redirected - but show a message just in case
  if (isDemoMode) {
    return (
      <div className="min-h-screen bg-background scanlines flex flex-col items-center justify-center p-4">
        <Card className="w-full max-w-md cyber-card">
          <CardHeader>
            <CardTitle className="font-mono flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-accent" />
              Demo Mode Active
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              You are running in demo mode. Redirecting to dashboard...
            </p>
            <Loader2 className="h-6 w-6 animate-spin text-accent mx-auto" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background scanlines flex flex-col items-center justify-center p-4">
      {/* Logo/Header */}
      <div className="mb-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <TrendingUp className="h-8 w-8 text-accent" />
          <h1 className="text-2xl font-bold font-mono tracking-wider text-accent">
            CRYPTO RISK AGENT
          </h1>
        </div>
        <p className="text-muted-foreground font-mono text-sm">
          Auth Gateway for the Trading Control Center
        </p>
      </div>

      <Card className="w-full max-w-md cyber-card">
        <Tabs defaultValue="signin" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin" className="font-mono">Sign In</TabsTrigger>
            <TabsTrigger value="signup" className="font-mono">Sign Up</TabsTrigger>
          </TabsList>

          <TabsContent value="signin">
            <form onSubmit={handleSignIn}>
              <CardHeader>
                <CardTitle className="font-mono flex items-center gap-2">
                  <Shield className="h-5 w-5 text-accent" />
                  Welcome Back
                </CardTitle>
                <CardDescription>
                  Sign in to access your trading dashboard
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email" className="font-mono">Email</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    placeholder="trader@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="font-mono"
                    disabled={isLoading}
                  />
                  {errors.email && (
                    <p className="text-xs text-destructive">{errors.email}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password" className="font-mono">Password</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="font-mono"
                    disabled={isLoading}
                  />
                  {errors.password && (
                    <p className="text-xs text-destructive">{errors.password}</p>
                  )}
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  type="submit"
                  className="w-full font-mono"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing In...
                    </>
                  ) : (
                    'Sign In'
                  )}
                </Button>
              </CardFooter>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignUp}>
              <CardHeader>
                <CardTitle className="font-mono flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-accent" />
                  Create Account
                </CardTitle>
                <CardDescription>
                  Create an account for the control center
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-email" className="font-mono">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="trader@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="font-mono"
                    disabled={isLoading}
                  />
                  {errors.email && (
                    <p className="text-xs text-destructive">{errors.email}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password" className="font-mono">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="font-mono"
                    disabled={isLoading}
                  />
                  {errors.password && (
                    <p className="text-xs text-destructive">{errors.password}</p>
                  )}
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  type="submit"
                  className="w-full font-mono"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating Account...
                    </>
                  ) : (
                    'Create Account'
                  )}
                </Button>
              </CardFooter>
            </form>
          </TabsContent>
        </Tabs>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground font-mono">
        Paper trading only • No real money involved
      </p>
    </div>
  );
};

export default Auth;
