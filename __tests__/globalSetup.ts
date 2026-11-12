import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate as applySchema } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';

// Builds the test database from nothing: drops every table, then applies the SQL in drizzle/.
// Refuses any database whose name doesn't end in _test, so a wrong DATABASE_URL can't wipe dev.
async function rebuildTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to rebuild "${databaseName}": the test database's name must end in _test`,
    );
  }

  // Quiet: DROP ... CASCADE reports every table it drops as a notice.
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  await client`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await client`DROP SCHEMA IF EXISTS public CASCADE`;
  await client`CREATE SCHEMA public`;
  await applySchema(drizzle(client), { migrationsFolder: './drizzle' });
  await client.end();
}

// Before the first run, and before every rerun in test:watch.
export default async function setup(project: TestProject) {
  await rebuildTestDatabase();
  project.onTestsRerun(rebuildTestDatabase);
}
