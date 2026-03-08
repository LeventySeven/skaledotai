import { config } from 'dotenv';
import { type Config } from 'drizzle-kit';

config({ path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.local' });

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
