import React, { useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import {
  auth,
  isUserAuthorized,
  loginWithGoogle,
  logoutUser,
  AUTHORIZED_EMAIL,
} from '../lib/firebase.js';
import { DEV_AUTH_BYPASS, devOwnerUser } from '../lib/devAuth.js';
import { AuthContext } from './authState.js';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(DEV_AUTH_BYPASS ? devOwnerUser() : null);
  const [loading, setLoading] = useState<boolean>(!DEV_AUTH_BYPASS);

  useEffect(() => {
    if (DEV_AUTH_BYPASS) return;
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    try {
      await loginWithGoogle();
    } catch (err) {
      console.error('Failed to log in:', err);
      throw err;
    }
  };

  const handleSignOut = async () => {
    try {
      await logoutUser();
    } catch (err) {
      console.error('Failed to log out:', err);
    }
  };

  const isAuthorized = isUserAuthorized(user);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthorized,
        signIn: handleSignIn,
        signOut: handleSignOut,
        authorizedEmail: AUTHORIZED_EMAIL,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
