import { beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ACTIVE_DB = path.resolve(process.cwd(), 'data', 'nutribodysim_db.json');
const BACKUP_DB = path.resolve(process.cwd(), 'data', 'nutribodysim_db.backup.json');

function computeSha256(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// 1. Record ground-truth hash of active working database before anything runs
const initialActiveHash = computeSha256(ACTIVE_DB);

// 2. Generate isolated test database path at top-level BEFORE importing store.ts
const workerId = process.env.VITEST_POOL_ID || process.env.VITEST_WORKER_ID || process.pid;
const suiteId = `${workerId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
const testDir = path.resolve(process.cwd(), 'data', '.test_dbs');
fs.mkdirSync(testDir, { recursive: true });

const isolatedDbPath = path.join(testDir, `test_db_${suiteId}.json`);

// 3. Seed isolated test database from pristine backup snapshot
if (fs.existsSync(BACKUP_DB)) {
  fs.copyFileSync(BACKUP_DB, isolatedDbPath);
} else if (fs.existsSync(ACTIVE_DB)) {
  fs.copyFileSync(ACTIVE_DB, isolatedDbPath);
}

// 4. Set environment variable BEFORE importing store.ts
process.env.NUTRIBODYSIM_DB_PATH = isolatedDbPath;

// 5. Dynamic import of store.ts: Now when DatabaseStore constructor runs,
// resolveDatabasePath() evaluates process.env.NUTRIBODYSIM_DB_PATH which points to isolatedDbPath!
// The active working database (data/nutribodysim_db.json) is NEVER read or written during initialization!
const { db } = await import('../../database/store');
const { initializeRuntimeDatabase, registerTestJsonStore } = await import('../../database/runtime');
registerTestJsonStore(db);
process.env.DATABASE_PROVIDER = 'json';
process.env.ENABLE_DEMO_AUTH = 'true';
await initializeRuntimeDatabase();

beforeAll(() => {
  // Ensure the singleton's path remains explicitly pointed to the isolated test database
  if (db && db.getDbFilePath() !== isolatedDbPath) {
    db.setStoragePath(isolatedDbPath);
  }
});

afterAll(() => {
  // Clean up only the temporary test database created for this suite
  if (isolatedDbPath && fs.existsSync(isolatedDbPath)) {
    try {
      fs.unlinkSync(isolatedDbPath);
    } catch {}
  }

  // Restore singleton to default active path
  process.env.NUTRIBODYSIM_DB_PATH = '';
  try {
    if (db) {
      db.setStoragePath(ACTIVE_DB);
    }
  } catch {}

  // Hard assertion: Active database must NEVER be mutated during tests
  const currentActiveHash = computeSha256(ACTIVE_DB);
  if (initialActiveHash && currentActiveHash !== initialActiveHash) {
    throw new Error(
      `FATAL TEST INTEGRITY VIOLATION: Active database (${ACTIVE_DB}) was modified during test execution! Initial: ${initialActiveHash}, Current: ${currentActiveHash}`
    );
  }
});
