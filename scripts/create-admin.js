// Creates an owner or staff account. Passwords come from the environment so they never appear in shell history.
// macOS/Linux:  ADMIN_PASSWORD='...' npm run create-admin -- you@example.com "Your Name"
// Windows:      $env:ADMIN_PASSWORD='...'; npm run create-admin -- you@example.com "Your Name"
import { getDatabase } from '../src/database.js';
import { hashPassword } from '../src/auth.js';
import { audit } from '../src/audit.js';
import { emailSchema, passwordSchema } from '../src/validation.js';

const [rawEmail, displayName = 'Owner'] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD || '';

const email = emailSchema.safeParse(rawEmail || '');
if (!email.success) {
  console.error('Usage: ADMIN_PASSWORD=... npm run create-admin -- <email> [display name]');
  process.exit(1);
}
const pw = passwordSchema.safeParse(password);
if (!pw.success) {
  console.error('Set ADMIN_PASSWORD to a password of at least 12 characters.');
  process.exit(1);
}

const db = getDatabase();
if (await db.get('SELECT id FROM users WHERE email = ?', [email.data])) {
  console.error('An account with that email already exists. Use the admin Users page to change it.');
  process.exit(1);
}
const hash = await hashPassword(pw.data);
const info = await db.run(
  'INSERT INTO users (email, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
  [email.data, displayName.slice(0, 80), hash, 'owner', Date.now()],
);
await audit(db, { userId: info.id, action: 'user.create', entity: 'user', entityId: info.id, detail: { role: 'owner', source: 'cli' } });
console.log(`Owner account created for ${email.data}.`);
await db.close();
