// Imports the products from the original single-file page (see scripts/legacy/convert-legacy.py).
// Safe to run more than once: products whose code already exists are skipped.
// The admin's "Import original products" button does the same thing from the browser.
import { getDatabase } from '../src/database.js';
import { importLegacyBatch } from '../src/legacy-import.js';

const db = getDatabase();
let total = 0;
const failures = [];
for (;;) {
  const result = await importLegacyBatch(db, { limit: 10 });
  total += result.imported;
  failures.push(...result.failed);
  if (result.imported === 0 || result.remaining <= 0) break;
}
console.log(`Imported ${total} products, failed ${failures.length}.`);
for (const f of failures) console.log(`  failed code ${f.code}: ${f.reason}`);
await db.close();
