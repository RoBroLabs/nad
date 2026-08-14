#!/usr/bin/env node

import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function resolveDatabasePath() {
  const dbUrl = process.env.DATABASE_URL;
  const value = dbUrl?.startsWith('file:') ? dbUrl.slice(5) : join(process.cwd(), 'data', 'nad.db');
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

async function passwordFromStdin() {
  if (!process.argv.includes('--password-stdin')) {
    throw new Error('Use --password-stdin so the recovery password is not stored in shell history.');
  }
  if (process.stdin.isTTY) throw new Error('Pipe the new password on standard input; interactive echo is not accepted.');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const password = Buffer.concat(chunks).toString('utf8').replace(/[\r\n]+$/, '');
  if (password.length < 10 || password.length > 1_024) {
    throw new Error('Password must be between 10 and 1024 characters.');
  }
  return password;
}

export async function recoverAdministrator({ databasePath, email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.length > 320) throw new Error('A valid administrator email is required.');
  const metadata = lstatSync(databasePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('NAD database must be a normal file.');
  const passwordHash = await bcrypt.hash(password, 12);
  const database = new Database(databasePath, { fileMustExist: true, timeout: 2_000 });
  try {
    database.pragma('foreign_keys = ON');
    const recover = database.transaction(() => {
      const user = database
        .prepare("SELECT id, role FROM users WHERE lower(email) = ?")
        .get(normalizedEmail);
      if (!user || user.role !== 'admin') throw new Error('Existing administrator account was not found.');
      database.prepare(`
        UPDATE users
        SET password_hash = ?, auth_version = auth_version + 1, updated_at = ?
        WHERE id = ?
      `).run(passwordHash, new Date().toISOString(), user.id);
      database.prepare(`
        INSERT INTO audit_log (id, user_id, action, module_slug, details, ip_address, created_at)
        VALUES (?, NULL, 'emergency_admin_recovery', NULL, ?, NULL, ?)
      `).run(randomUUID(), JSON.stringify({ userId: user.id, method: 'offline-cli' }), new Date().toISOString());
      return user.id;
    });
    return recover.exclusive();
  } finally {
    database.close();
  }
}

async function main() {
  if (!process.argv.includes('--confirm-offline')) {
    throw new Error('Stop NAD first, then pass --confirm-offline to acknowledge exclusive recovery.');
  }
  const email = argument('--email');
  if (!email) throw new Error('Usage: admin-recover --email <admin> --password-stdin --confirm-offline');
  const password = await passwordFromStdin();
  const userId = await recoverAdministrator({ databasePath: resolveDatabasePath(), email, password });
  process.stdout.write(`Administrator recovery completed for user ${userId}; existing sessions were invalidated.\n`);
}

main().catch((error) => {
  console.error(`Administrator recovery failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
