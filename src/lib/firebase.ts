import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, User } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

// Explicitly use the provisioned firestore database ID
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');

export const AUTHORIZED_EMAIL = 'the.derek.leavitt@gmail.com';

export function isUserAuthorized(user: User | null): boolean {
  if (!user || !user.email) return false;
  return user.email.toLowerCase() === AUTHORIZED_EMAIL.toLowerCase();
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
