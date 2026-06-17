import { Link } from 'react-router-dom';

export default function ResetPassword() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center font-mono">
      <div className="max-w-sm w-full px-4">
        <h1 className="text-2xl font-bold mb-2">Reset Password</h1>
        <p className="text-muted-foreground text-sm mb-4">
          Password reset is handled via your auth provider.
        </p>
        <Link to="/auth" className="text-accent underline text-sm">Back to sign in</Link>
      </div>
    </main>
  );
}
