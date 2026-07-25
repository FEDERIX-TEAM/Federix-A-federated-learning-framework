/* eslint-disable no-console */
require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');
const config = require('../src/config');
const AdminUser = require('../src/models/AdminUser');
const { hashPassword } = require('../src/utils/password');
const { newId } = require('../src/utils/ids');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

async function main() {
  await mongoose.connect(config.mongoUri);

  const existing = await AdminUser.findOne({ role: 'super_admin' });
  if (existing) {
    console.log(`A super_admin already exists: ${existing.email}`);
    process.exit(0);
  }

  const email = await ask('Super admin email: ');
  const name = await ask('Super admin name: ');
  const password = await ask('Super admin password: ');

  const user = await AdminUser.create({
    user_id: newId(),
    email: email.toLowerCase().trim(),
    name: name.trim(),
    password_hash: await hashPassword(password),
    role: 'super_admin',
  });

  console.log(`Created super_admin ${user.email} (user_id: ${user.user_id})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
