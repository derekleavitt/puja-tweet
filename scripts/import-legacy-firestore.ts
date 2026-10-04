/**
 * One-time import of the legacy AI Studio Firestore data (contexts, postLogs, settings) into the
 * current store. Preview by default; writes only with --apply.
 *
 *   npm run import:legacy                        preview against Firestore (default store)
 *   npm run import:legacy -- --apply             write
 *   npm run import:legacy -- --from-json f.json  read an export { contexts, postLogs, settings }
 *   npm run import:legacy -- --store json        target the local JSON store (testing)
 */

import 'dotenv/config';
import fs from 'fs';
import { getFirestore } from 'firebase-admin/firestore';
import { firestoreConfig } from '../server/config.js';
import { getAdminApp } from '../server/firebaseAdmin.js';
import {
  formatReport,
  mergeLegacyData,
  type LegacyData,
  type LegacyDoc,
} from '../server/migration/legacyImport.js';
import { FirestoreStore } from '../server/store/FirestoreStore.js';
import { JsonFileStore } from '../server/store/JsonFileStore.js';
import type { Store } from '../server/store/Store.js';

interface ImportArgs {
  apply: boolean;
  store: 'firestore' | 'json';
  fromJson?: string;
}

const parseArgs = (argv: string[]): ImportArgs => {
  const args: ImportArgs = { apply: false, store: 'firestore' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--from-json') {
      args.fromJson = argv[++i];
      if (!args.fromJson) throw new Error('--from-json needs a file');
    } else if (a === '--store') {
      const v = argv[++i];
      if (v !== 'json' && v !== 'firestore') throw new Error('--store must be json or firestore');
      args.store = v;
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
};

/** Accepts `[{id, ...}]` or `{ docId: {...} }` for each collection in a manual export. */
const toDocs = (v: unknown): LegacyDoc[] => {
  if (Array.isArray(v)) return v.map((d, i) => ({ id: String(d?.id ?? `doc_${i}`), data: d }));
  if (v && typeof v === 'object') {
    return Object.entries(v).map(([id, data]) => ({ id, data: data as Record<string, any> }));
  }
  return [];
};

const readJson = (file: string): LegacyData => {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const settings = raw.settings?.global_settings ?? raw.settings ?? null;
  return { contexts: toDocs(raw.contexts), postLogs: toDocs(raw.postLogs), settings };
};

const readFirestore = async (): Promise<LegacyData> => {
  const db = getFirestore(getAdminApp(), firestoreConfig.databaseId);
  const [contexts, logs, settings] = await Promise.all([
    db.collection('contexts').get(),
    db.collection('postLogs').get(),
    db.collection('settings').doc('global_settings').get(),
  ]);
  return {
    contexts: contexts.docs.map((d) => ({ id: d.id, data: d.data() })),
    postLogs: logs.docs.map((d) => ({ id: d.id, data: d.data() })),
    settings: settings.exists ? (settings.data() ?? null) : null,
  };
};

const openStore = (kind: ImportArgs['store']): Store =>
  kind === 'json'
    ? new JsonFileStore()
    : new FirestoreStore(getFirestore(getAdminApp(), firestoreConfig.databaseId));

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const source = args.fromJson ?? `Firestore "${firestoreConfig.databaseId}"`;
  console.log(`[Import] Source: ${source}; target store: ${args.store}`);
  const legacy = args.fromJson ? readJson(args.fromJson) : await readFirestore();
  const store = openStore(args.store);
  const { state, report } = mergeLegacyData(await store.load(), legacy);
  if (report.contexts.added) {
    console.log(
      '[Import] Imported campaigns are forced to PAUSED + DRY-RUN regardless of old state.',
    );
  }
  console.log(formatReport(report, args.apply));
  if (args.apply) {
    await store.save(state);
    console.log('[Import] State saved. Restart the server (or import before the first deploy).');
  }
}

main().catch((err) => {
  console.error('[Import] Failed:', err);
  process.exit(1);
});
