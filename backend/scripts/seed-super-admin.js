/* Creates the first super_admin.
 * Interactive:      npm run seed:super-admin
 * Non-interactive:  SEED_EMAIL=a@b.com SEED_NAME="Root" SEED_PASSWORD=secret123 npm run seed:super-admin
 */
import readline from 'node:readline';
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { AdminUser } from '../models/AdminUser.js';
import { hashPassword } from '../utils/password.js';
import { newId } from '../utils/ids.js';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

async function main() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });

  const existing = await AdminUser.findOne({ role: 'super_admin' });
  if (existing) {
    console.log(`A super_admin already exists: ${existing.email}`);
    return;
  }

  const email = (process.env.SEED_EMAIL || (await ask('Super admin email: '))).toLowerCase().trim();
  const name = (process.env.SEED_NAME || (await ask('Super admin name: '))).trim();
  const password = process.env.SEED_PASSWORD || (await ask('Super admin password (min 8 chars): '));
  if (!email || !name || password.length < 8) throw new Error('email, name and a password of at least 8 characters are required');

  const user = await AdminUser.create({
    user_id: newId(),
    email,
    name,
    password_hash: await hashPassword(password),
    role: 'super_admin',
  });
  console.log(`Created super_admin ${user.email} (user_id: ${user.user_id})`);
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
