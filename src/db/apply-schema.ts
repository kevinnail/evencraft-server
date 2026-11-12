import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate as applySchema } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Applies the SQL files in drizzle/ that the database hasn't run yet. Railway runs it before each
// deploy, and a failure exits non-zero so the deploy stops.
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);
  await applySchema(db, { migrationsFolder: './drizzle' });
  await client.end();
  console.info('Schema applied to database successfully');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
