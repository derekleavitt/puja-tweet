/**
 * X ChromaBot - auth context object and hook
 * Kept apart from the provider component so fast refresh keeps working.
 */

import { createContext, useContext } from 'react';
import type { User } from 'firebase/auth';
import { AUTHORIZED_EMAIL } from '../lib/firebase.js';

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthorized: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  authorizedEmail: string;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAuthorized: false,
  signIn: async () => {},
  signOut: async () => {},
  authorizedEmail: AUTHORIZED_EMAIL,
});

export const useAuth = () => useContext(AuthContext);
