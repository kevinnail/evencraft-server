import { sql } from 'drizzle-orm';
import { db } from '../../src/db/connection';

// Empties every table between tests, so each test starts from a clean database.
export async function resetDb(): Promise<void> {
  await db.execute(sql`TRUNCATE "user", session, account, verification CASCADE`);
}
