import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const connectionString = getRequiredEnv('DATABASE_URL');

// Prevent multiple connections in development (HMR creates new modules on each change)
const globalForDb = globalThis as unknown as {
  postgres: ReturnType<typeof postgres> | undefined;
};

const client = globalForDb.postgres ?? postgres(connectionString, { prepare: false });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.postgres = client;
}

export const db = drizzle(client, { schema });
