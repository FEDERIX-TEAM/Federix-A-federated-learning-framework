import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';

export async function hashPassword(plain) {
  return bcrypt.hash(plain, config.security.bcryptRounds);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
