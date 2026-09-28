import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, isUserAuthorized, loginWithGoogle, logoutUser, AUTHORIZED_EMAIL } from '../lib/firebase.js';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthorized: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  authorizedEmail: string;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAuthorized: false,
  signIn: async () => {},
  signOut: async () => {},
  authorizedEmail: AUTHORIZED_EMAIL,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    try {
      await loginWithGoogle();
    } catch (err: any) {
      console.error('Failed to log in:', err);
      throw err;
    }
  };

  const handleSignOut = async () => {
    try {
      await logoutUser();
    } catch (err: any) {
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

export const useAuth = () => useContext(AuthContext);
