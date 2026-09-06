import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  Shield,
  TrendingUp,
} from 'lucide-react';
import { resolvePostAuthPath } from '@/lib/authNavigation';

const emailSchema = z.string().trim().email('Please enter a valid email address');

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});

const signUpSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(12, 'Use at least 12 characters')
    .regex(/[a-z]/, 'Add a lowercase letter')
    .regex(/[A-Z]/, 'Add an uppercase letter')
    .regex(/[0-9]/, 'Add a number'),
  confirmPassword: z.string(),
}).refine((value) => value.password === value.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type FieldErrors = {
  email?: string;
  password?: string;
  confirmPassword?: string;
};

type AuthTab = 'signin' | 'signup';

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
    return 'Password does not meet the identity provider security policy.';
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('failed to fetch') || lower.includes('load failed')) {
    return 'Secure sign-in service could not be reached. Check your connection and try again.';
  }
  if (lower.includes('signup disabled') || lower.includes('signups not allowed')) {
    return 'New account registration is currently disabled. Contact an authorized administrator.';
  }

  return message || 'The authentication request could not be completed. Please try again.';
}

function collectErrors(result: z.SafeParseError<unknown>): FieldErrors {
  const next: FieldErrors = {};
  result.error.errors.forEach((error) => {
    const field = error.path[0];
    if (field === 'email' || field === 'password' || field === 'confirmPassword') {
      next[field] = error.message;
    }
  });
  return next;
}

const Auth = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user,
    isLoading: authLoading,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
    authUnconfigured,
    isDemoMode,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<AuthTab>('signin');
  const [isLoading, setIsLoading] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const returnPath = resolvePostAuthPath((location.state as { from?: unknown } | null)?.from);

  const handleTabChange = (value: string) => {
    const next = value === 'signup' ? 'signup' : 'signin';
    setActiveTab(next);
    setRecoveryMode(false);
    setErrors({});
    setPassword('');
    setConfirmPassword('');
  };

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = signInSchema.safeParse({ email, password });
    if (!result.success) {
      setErrors(collectErrors(result));
      return;
    }

    setErrors({});
    setIsLoading(true);
    try {
      const { error } = await signIn(result.data.email, result.data.password);
      if (error) {
        toast.error(friendlyAuthError(error.message));
        return;
      }

      toast.success('Identity verified.');
      navigate(returnPath, { replace: true });
    } catch {
      toast.error('The authentication request could not be completed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = signUpSchema.safeParse({ email, password, confirmPassword });
    if (!result.success) {
      setErrors(collectErrors(result));
      return;
    }

    setErrors({});
    setIsLoading(true);
    try {
      const { error } = await signUp(result.data.email, result.data.password);
      if (error) {
        toast.error(friendlyAuthError(error.message));
        return;
      }

      toast.success('Account created. Confirm the verification email before signing in.');
      setActiveTab('signin');
      setPassword('');
      setConfirmPassword('');
    } catch {
      toast.error('The registration request could not be completed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordReset = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = emailSchema.safeParse(email);
    if (!result.success) {
      setErrors({ email: result.error.errors[0]?.message || 'Enter a valid email address' });
      return;
    }

    setErrors({});
    setIsLoading(true);
    try {
      const { error } = await requestPasswordReset(result.data);
      if (error) {
        toast.error(friendlyAuthError(error.message));
        return;
      }

      toast.success('If that account exists, a secure password-reset email has been sent.');
      setRecoveryMode(false);
    } catch {
      toast.error('The password-reset request could not be completed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwitchAccount = async () => {
    setIsLoading(true);
    try {
      await signOut();
      setPassword('');
      setConfirmPassword('');
      setActiveTab('signin');
      toast.success('Signed out. You can now use another account.');
    } catch {
      toast.error('Unable to close the current session.');
    } finally {
      setIsLoading(false);
    }
  };

  if (authLoading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="flex items-center gap-3 rounded-lg border bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
          Verifying secure session…
        </div>
      </main>
    );
  }

  if (user && !isDemoMode) {
    return (
      <main className="min-h-screen bg-background scanlines flex flex-col items-center justify-center p-4">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <TrendingUp className="h-8 w-8 text-accent" />
            <h1 className="text-2xl font-bold font-mono tracking-wider text-accent">
              CRYPTO SIGNAL BOT V2
            </h1>
          </div>
          <p className="text-muted-foreground font-mono text-sm">Secure Production Access Gateway</p>
        </div>

        <Card className="w-full max-w-lg cyber-card">
          <CardHeader>
            <CardTitle className="font-mono flex items-center gap-2">
              <Shield className="h-5 w-5 text-accent" />
              Verified session
            </CardTitle>
            <CardDescription>
              {user.email || 'This browser has a verified authenticated identity.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="rounded-md border bg-muted/30 p-3">
              Authentication is complete. Product access remains controlled by server-authoritative account status and scoped roles.
            </div>
            <p>
              The login gateway stays available even with an active session, so switching accounts or reviewing access never requires clearing browser data.
            </p>
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button className="w-full font-mono" onClick={() => navigate(returnPath, { replace: true })}>
              Continue to requested area
            </Button>
            <Button variant="outline" className="w-full font-mono" onClick={() => navigate('/account')}>
              Account & access
            </Button>
            <Button
              variant="outline"
              className="w-full font-mono"
              onClick={() => void handleSwitchAccount()}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
              Sign out and use another account
            </Button>
          </CardFooter>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground font-mono">
          Paper / testnet release · Role-gated access · No provider mutation or real funds
        </p>
      </main>
    );
  }

  if (authUnconfigured) {
    return (
      <main className="min-h-screen bg-background scanlines flex flex-col items-center justify-center p-4">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <TrendingUp className="h-8 w-8 text-accent" />
            <h1 className="text-2xl font-bold font-mono tracking-wider text-accent">
              CRYPTO SIGNAL BOT V2
            </h1>
          </div>
          <p className="text-muted-foreground font-mono text-sm">Secure Production Access Gateway</p>
        </div>

        <Card className="w-full max-w-lg cyber-card border-warning">
          <CardHeader>
            <CardTitle className="font-mono flex items-center gap-2 text-warning">
              <AlertTriangle className="h-5 w-5" />
              Secure identity service unavailable
            </CardTitle>
            <CardDescription>
              Protected access is fail-closed. Public production surfaces remain available.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              This deployment cannot verify user identities right now. No protected route will be opened without a verified session.
            </p>
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button className="w-full font-mono" onClick={() => window.location.reload()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry secure access
            </Button>
            <Button variant="outline" className="w-full font-mono" onClick={() => navigate('/status')}>
              View production status
            </Button>
            <Button variant="outline" className="w-full font-mono" onClick={() => navigate('/')}>
              Public home
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  }

  if (isDemoMode) {
    return (
      <main className="min-h-screen bg-background scanlines flex flex-col items-center justify-center p-4">
        <Card className="w-full max-w-lg cyber-card">
          <CardHeader>
            <CardTitle className="font-mono flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-accent" />
              Certification identity active
            </CardTitle>
            <CardDescription>
              This non-production preview uses the local paper-mode identity only.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex-col gap-2">
            <Button className="w-full font-mono" onClick={() => navigate('/dashboard')}>
              Continue to certification dashboard
            </Button>
            <Button variant="outline" className="w-full font-mono" onClick={() => navigate('/')}>
              Public home
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background scanlines flex flex-col items-center justify-center p-4">
      <div className="mb-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <TrendingUp className="h-8 w-8 text-accent" />
          <h1 className="text-2xl font-bold font-mono tracking-wider text-accent">
            CRYPTO SIGNAL BOT V2
          </h1>
        </div>
        <p className="text-muted-foreground font-mono text-sm">
          Secure Production Access Gateway
        </p>
      </div>

      <Card className="w-full max-w-lg cyber-card">
        <div className="border-b bg-muted/20 px-6 py-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent" />
              Identity verified by Supabase
            </span>
            <span>Application roles enforced server-side</span>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin" className="font-mono">Sign In</TabsTrigger>
            <TabsTrigger value="signup" className="font-mono">Create Account</TabsTrigger>
          </TabsList>

          <TabsContent value="signin">
            {recoveryMode ? (
              <form onSubmit={handlePasswordReset}>
                <CardHeader>
                  <CardTitle className="font-mono flex items-center gap-2">
                    <KeyRound className="h-5 w-5 text-accent" />
                    Recover access
                  </CardTitle>
                  <CardDescription>
                    Request a secure recovery link. Existing application roles are not changed.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="recovery-email" className="font-mono">Email</Label>
                    <Input
                      id="recovery-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="trader@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="font-mono"
                      disabled={isLoading}
                    />
                    {errors.email && <p className="text-xs text-destructive" role="alert">{errors.email}</p>}
                  </div>
                </CardContent>
                <CardFooter className="flex-col gap-2">
                  <Button type="submit" className="w-full font-mono" disabled={isLoading}>
                    {isLoading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending secure link…</>
                    ) : 'Send recovery link'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full font-mono"
                    onClick={() => {
                      setRecoveryMode(false);
                      setErrors({});
                    }}
                    disabled={isLoading}
                  >
                    Back to sign in
                  </Button>
                </CardFooter>
              </form>
            ) : (
              <form onSubmit={handleSignIn}>
                <CardHeader>
                  <CardTitle className="font-mono flex items-center gap-2">
                    <Shield className="h-5 w-5 text-accent" />
                    Sign in securely
                  </CardTitle>
                  <CardDescription>
                    Verify your identity, then continue through server-side account and role authorization.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email" className="font-mono">Email</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="trader@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="font-mono"
                      disabled={isLoading}
                    />
                    {errors.email && <p className="text-xs text-destructive" role="alert">{errors.email}</p>}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="signin-password" className="font-mono">Password</Label>
                      <button
                        type="button"
                        className="text-xs text-accent underline-offset-4 hover:underline disabled:opacity-50"
                        onClick={() => {
                          setRecoveryMode(true);
                          setErrors({});
                        }}
                        disabled={isLoading}
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <Input
                        id="signin-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="Enter password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="font-mono pr-11"
                        disabled={isLoading}
                      />
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword((value) => !value)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        disabled={isLoading}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {errors.password && <p className="text-xs text-destructive" role="alert">{errors.password}</p>}
                  </div>
                </CardContent>
                <CardFooter className="flex-col gap-3">
                  <Button type="submit" className="w-full font-mono" disabled={isLoading}>
                    {isLoading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verifying identity…</>
                    ) : 'Sign In'}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    Successful authentication does not bypass account status, scoped roles, Guardian controls, or release safety locks.
                  </p>
                </CardFooter>
              </form>
            )}
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignUp}>
              <CardHeader>
                <CardTitle className="font-mono flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-accent" />
                  Create secure account
                </CardTitle>
                <CardDescription>
                  Registration creates an identity only. Protected product access still requires an authorized scoped role.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-email" className="font-mono">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="trader@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="font-mono"
                    disabled={isLoading}
                  />
                  {errors.email && <p className="text-xs text-destructive" role="alert">{errors.email}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-password" className="font-mono">Password</Label>
                  <div className="relative">
                    <Input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Create a strong password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="font-mono pr-11"
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      disabled={isLoading}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.password && <p className="text-xs text-destructive" role="alert">{errors.password}</p>}
                  <p className="text-xs text-muted-foreground">
                    Minimum 12 characters with uppercase, lowercase, and a number.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-password-confirm" className="font-mono">Confirm password</Label>
                  <div className="relative">
                    <Input
                      id="signup-password-confirm"
                      type={showConfirmPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Repeat password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      className="font-mono pr-11"
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                      onClick={() => setShowConfirmPassword((value) => !value)}
                      aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'}
                      disabled={isLoading}
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.confirmPassword && <p className="text-xs text-destructive" role="alert">{errors.confirmPassword}</p>}
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-3">
                <Button type="submit" className="w-full font-mono" disabled={isLoading}>
                  {isLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating secure identity…</>
                  ) : 'Create Account'}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Email verification and application role assignment are separate authorization gates.
                </p>
              </CardFooter>
            </form>
          </TabsContent>
        </Tabs>
      </Card>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground font-mono">
        <button type="button" className="hover:text-foreground" onClick={() => navigate('/status')}>
          Production status
        </button>
        <span aria-hidden="true">•</span>
        <button type="button" className="hover:text-foreground" onClick={() => navigate('/')}>
          Public home
        </button>
      </div>
      <p className="mt-3 max-w-lg text-center text-xs text-muted-foreground font-mono">
        Paper / testnet release · BTCC primary · Bitget secondary · No live trading, withdrawals, provider mutation, or real funds
      </p>
    </main>
  );
};

export default Auth;
