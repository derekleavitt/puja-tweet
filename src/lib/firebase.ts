import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, User } from 'firebase/auth';
import appletConfig from '../../firebase-applet-config.json';
import { OWNER_EMAIL } from '../../shared/owner.js';

const env = import.meta.env;

/** VITE_FIREBASE_* values override the checked-in firebase-applet-config.json (the AI Studio fallback). */
const firebaseConfig = {
  ...appletConfig,
  ...(env.VITE_FIREBASE_API_KEY && { apiKey: env.VITE_FIREBASE_API_KEY }),
  ...(env.VITE_FIREBASE_AUTH_DOMAIN && { authDomain: env.VITE_FIREBASE_AUTH_DOMAIN }),
  ...(env.VITE_FIREBASE_PROJECT_ID && { projectId: env.VITE_FIREBASE_PROJECT_ID }),
  ...(env.VITE_FIREBASE_APP_ID && { appId: env.VITE_FIREBASE_APP_ID }),
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

/** Emails allowed in the UI: VITE_AUTHORIZED_EMAILS (comma-separated), default the owner. */
export const AUTHORIZED_EMAILS: string[] = (env.VITE_AUTHORIZED_EMAILS || OWNER_EMAIL)
  .split(',')
  .map((email: string) => email.trim().toLowerCase())
  .filter(Boolean);

/** Primary admin email, shown on the login screen. */
export const AUTHORIZED_EMAIL = AUTHORIZED_EMAILS[0] ?? OWNER_EMAIL;

export function isUserAuthorized(user: User | null): boolean {
  if (!user || !user.email) return false;
  return AUTHORIZED_EMAILS.includes(user.email.toLowerCase());
}

export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (err) {
    console.error('Sign-in error:', err);
    throw err;
  }
}

export async function logoutUser() {
  await signOut(auth);
}
