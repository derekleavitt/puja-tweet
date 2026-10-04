/**
 * Typed environment access for X ChromaBot server.
 * Single place that reads process.env for server wiring.
 */

import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 3000,
  isProduction: process.env.NODE_ENV === 'production',
};
