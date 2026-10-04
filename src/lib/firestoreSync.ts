import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, AUTHORIZED_EMAIL } from '../lib/firebase.js';
import { BotSettings, PostLog, TweetContext } from '../types.js';

const SETTINGS_DOC_ID = 'global_settings';

export async function loadFirestoreSettings(): Promise<BotSettings | null> {
  try {
    const docRef = doc(db, 'settings', SETTINGS_DOC_ID);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as BotSettings;
    }
  } catch (err) {
    console.warn('Could not read settings from Firestore:', err);
  }
  return null;
}

export async function saveFirestoreSettings(settings: BotSettings): Promise<void> {
  try {
    const docRef = doc(db, 'settings', SETTINGS_DOC_ID);
    await setDoc(
      docRef,
      {
        ...settings,
        updatedAt: new Date().toISOString(),
        updatedBy: AUTHORIZED_EMAIL,
      },
      { merge: true },
    );
  } catch (err) {
    console.error('Failed to sync settings to Firestore:', err);
  }
}

// --- Contexts Firestore Sync ---

export async function loadFirestoreContexts(): Promise<TweetContext[]> {
  try {
    const collRef = collection(db, 'contexts');
    const snap = await getDocs(collRef);
    const items: TweetContext[] = [];
    snap.forEach((d) => {
      items.push({ id: d.id, ...d.data() } as TweetContext);
    });
    return items;
  } catch (err) {
    console.warn('Could not read contexts from Firestore:', err);
    return [];
  }
}

export async function saveFirestoreContext(context: TweetContext): Promise<void> {
  try {
    const docRef = doc(db, 'contexts', context.id);
    await setDoc(
      docRef,
      {
        ...context,
        updatedAt: new Date().toISOString(),
        authorEmail: AUTHORIZED_EMAIL,
      },
      { merge: true },
    );
  } catch (err) {
    console.error('Failed to save context to Firestore:', err);
  }
}

export async function deleteFirestoreContext(contextId: string): Promise<void> {
  try {
    const docRef = doc(db, 'contexts', contextId);
    await deleteDoc(docRef);
  } catch (err) {
    console.error('Failed to delete context from Firestore:', err);
  }
}

export async function syncAllFirestoreContexts(contexts: TweetContext[]): Promise<void> {
  for (const ctx of contexts) {
    await saveFirestoreContext(ctx);
  }
}

// --- Post Logs Sync ---

export async function recordFirestoreLog(log: PostLog): Promise<void> {
  try {
    const collRef = collection(db, 'postLogs');
    await addDoc(collRef, {
      ...log,
      syncedAt: new Date().toISOString(),
      authorEmail: AUTHORIZED_EMAIL,
    });
  } catch (err) {
    console.error('Failed to save log to Firestore:', err);
  }
}

export async function loadFirestoreLogs(): Promise<PostLog[]> {
  try {
    const collRef = collection(db, 'postLogs');
    const q = query(collRef, orderBy('timestamp', 'desc'), limit(50));
    const snap = await getDocs(q);
    const items: PostLog[] = [];
    snap.forEach((d) => {
      items.push({ id: d.id, ...d.data() } as PostLog);
    });
    return items;
  } catch (err) {
    console.warn('Could not fetch Firestore logs:', err);
    return [];
  }
}
