/**
 * Boot entrypoint for X ChromaBot.
 * Loads env, creates the API app, attaches Vite/static frontend, starts the scheduler and listens.
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './app.js';
import { config } from './config.js';
import { markSchedulerStarted } from './routes/health.js';
import { scheduler } from './scheduler.js';
import { dropService } from './services/dropService.js';
import { services } from './services/index.js';

const rootDir = config.rootDir;

async function startServer() {
  const app = createApp({ services, scheduler, drops: dropService });

  // Start background multi-context scheduler
  scheduler.start();
  markSchedulerStarted();

  // Vite or Static files handling
  if (config.isProduction) {
    app.use(express.static(path.resolve(rootDir, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(rootDir, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[X-ChromaBot] Server running at http://0.0.0.0:${config.port}`);
  });

  // Flush debounced state to the store before the process exits (async: Firestore has no sync write).
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[X-ChromaBot] ${signal} received, flushing state`);
    scheduler.stop?.();
    try {
      // Cloud Run allows ~10 s between SIGTERM and SIGKILL.
      await Promise.race([
        services.flush(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('flush timed out')), 8000).unref(),
        ),
      ]);
    } catch (err) {
      console.error('[X-ChromaBot] Shutdown flush failed:', err);
    }
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
