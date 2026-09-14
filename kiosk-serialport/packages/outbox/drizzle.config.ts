import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

const dbPath =
  process.env.OUTBOX_DB_PATH ?? path.join(os.homedir(), '.kiosk', 'outbox.db');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: dbPath },
  strict: true,
  verbose: true,
});
