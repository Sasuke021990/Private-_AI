import fs from 'fs';
import path from 'path';
import sshpk from 'sshpk';
import { prisma } from '../db';

const AUTHORIZED_KEYS_PATH = '/usr/src/app/authorized_keys';

function assertValidSshPublicKey(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8192) {
    throw new Error('Invalid public key');
  }
  const trimmed = raw.trim();
  if (/[\r\n\x00-\x1f]/.test(trimmed)) {
    throw new Error('Public key must not contain control characters or newlines');
  }
  sshpk.parseKey(trimmed, 'ssh'); // throws on anything malformed
  return trimmed;
}

// Serializes regenerateAuthorizedKeys() calls so overlapping async writes can't interleave.
let writeQueue: Promise<void> = Promise.resolve();

async function regenerateAuthorizedKeys(): Promise<void> {
  const routes = await prisma.route.findMany({ where: { sshPublicKey: { not: null } } });
  const lines = routes.map(r => r.sshPublicKey).filter((k): k is string => !!k);
  const content = lines.length > 0 ? lines.join('') : '';

  await fs.promises.mkdir(path.dirname(AUTHORIZED_KEYS_PATH), { recursive: true }).catch(() => {});
  // NOTE: this file is typically a Docker bind-mount of a single host file
  // (docker-compose.yml: ~/.ssh/authorized_keys:/usr/src/app/authorized_keys).
  // The usual "write to a temp file then rename() into place" pattern for atomic
  // replacement does NOT work here — rename()'ing a new inode onto a bind-mount
  // target fails with EBUSY, since the mount point can't be replaced that way.
  // Writing directly to the file's existing inode works fine (Docker bind mounts
  // support in-place writes, just not being swapped out via rename).
  await fs.promises.writeFile(AUTHORIZED_KEYS_PATH, content, { mode: 0o600 });
}

function queueRegenerate(): Promise<void> {
  // Chain onto the queue so writes never interleave, but don't let a failed attempt
  // wedge the queue forever — the next call should still get to try. The rejection
  // from THIS attempt is still returned to its own caller so failures aren't silently
  // swallowed (e.g. so "add route" surfaces an error instead of reporting success
  // while the SSH key silently never made it to disk).
  const attempt = writeQueue.then(() => regenerateAuthorizedKeys());
  writeQueue = attempt.catch(err => {
    console.error('Failed to regenerate authorized_keys:', err);
  });
  return attempt;
}

export async function registerKeyForRoute(routeId: string, publicKey: string, port: string | number): Promise<void> {
  const validated = assertValidSshPublicKey(publicKey);
  const restrictedKey = `command="/bin/false",no-pty,no-X11-forwarding,permitopen="localhost:${port}" ${validated}\n`;

  await prisma.route.update({
    where: { id: routeId },
    data: { sshPublicKey: restrictedKey, sshKeyAddedAt: new Date() },
  });

  await queueRegenerate();
}

export async function revokeKeyForRoute(routeId: string): Promise<void> {
  await prisma.route.update({
    where: { id: routeId },
    data: { sshPublicKey: null, sshKeyAddedAt: null },
  }).catch(() => {}); // route may already be deleted by the caller

  await queueRegenerate();
}

export async function revokeAllKeysForUser(userId: string): Promise<void> {
  const routes = await prisma.route.findMany({ where: { userId, sshPublicKey: { not: null } } });
  if (routes.length === 0) return;

  await prisma.route.updateMany({
    where: { userId, sshPublicKey: { not: null } },
    data: { sshPublicKey: null, sshKeyAddedAt: null },
  });

  await queueRegenerate();
}
