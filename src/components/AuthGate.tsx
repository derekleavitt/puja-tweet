import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { ShieldAlert, LogIn, Lock, CheckCircle2, AlertTriangle } from 'lucide-react';

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading, isAuthorized, signIn, signOut, authorizedEmail } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-neutral-400">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-mono">Verifying authorization credentials...</p>
      </div>
    );
  }

  // Case 1: Not signed in
  if (!user) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-indigo-600 flex items-center justify-center shadow-md">
              <Lock className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-neutral-100">ChromaBot Admin</h1>
              <p className="text-xs text-neutral-400">Restricted Management Console</p>
            </div>
          </div>

          <div className="bg-neutral-950/60 border border-neutral-800/80 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-neutral-300 leading-relaxed">
                This console is locked behind Google Authentication. Access is strictly whitelisted
                for:
                <div className="mt-1 font-mono font-medium text-indigo-400 bg-neutral-900 px-2 py-1 rounded inline-block">
                  {authorizedEmail}
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-950/40 border border-red-800 text-xs text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={async () => {
              try {
                setError(null);
                setSigningIn(true);
                await signIn();
              } catch (err: any) {
                setError(err.message || 'Sign in failed. Please try again.');
              } finally {
                setSigningIn(false);
              }
            }}
            disabled={signingIn}
            className="w-full py-3 px-4 rounded-xl bg-white hover:bg-neutral-100 text-neutral-900 font-medium text-sm transition-all shadow-md flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-50"
          >
            {signingIn ? (
              <span className="w-4 h-4 border-2 border-neutral-900/30 border-t-neutral-900 rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
            )}
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  // Case 2: Signed in, but NOT the authorized email
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-8 shadow-2xl text-center">
          <div className="w-12 h-12 rounded-full bg-red-950/60 border border-red-800 text-red-400 mx-auto flex items-center justify-center mb-4">
            <ShieldAlert className="w-6 h-6" />
          </div>

          <h2 className="text-lg font-bold text-neutral-100 mb-1">Access Denied</h2>
          <p className="text-xs text-neutral-400 mb-4">
            You are signed in as <span className="font-mono text-neutral-200">{user.email}</span>,
            which is not authorized to manage this bot.
          </p>

          <div className="p-3 rounded-lg bg-neutral-950/80 border border-neutral-800 text-xs text-neutral-400 mb-6 text-left">
            <p className="text-neutral-300 font-medium mb-1">Required Authorized Account:</p>
            <p className="font-mono text-indigo-400">{authorizedEmail}</p>
          </div>

          <button
            onClick={() => signOut()}
            className="w-full py-2.5 px-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium text-xs transition-colors cursor-pointer"
          >
            Sign out & Switch Account
          </button>
        </div>
      </div>
    );
  }

  // Case 3: Authorized! Render app
  return <>{children}</>;
};
