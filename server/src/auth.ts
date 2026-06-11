import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from './db';

// Mapping of username → nationId for the 5 founding players.
// Used when creating sessions so the session carries nationId.
export const PLAYER_NATION_MAP: Record<string, string> = {
  player1: 'nation_costa_rica',
  player2: 'nation_guatemala',
  player3: 'nation_honduras',
  player4: 'nation_nicaragua',
  player5: 'nation_panama',
};

const BCRYPT_ROUNDS = 12;
const SESSION_TTL_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function registerUser(username: string, password: string): Promise<{ ok: true; userId: number } | { ok: false; error: string }> {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return { ok: false, error: 'Username already taken' };
  const passwordHash = await hashPassword(password);
  const user = await (prisma as any).user.create({ data: { username, passwordHash } });
  return { ok: true, userId: user.id };
}

export async function loginUser(username: string, password: string): Promise<{ ok: true; token: string; nationId: string | null } | { ok: false; error: string }> {
  const user = await (prisma as any).user.findUnique({ where: { username } });
  if (!user) return { ok: false, error: 'Invalid credentials' };
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { ok: false, error: 'Invalid credentials' };

  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const nationId = PLAYER_NATION_MAP[username] ?? null;

  await (prisma as any).userSession.create({
    data: { userId: user.id, token, nationId, expiresAt },
  });

  return { ok: true, token, nationId };
}

export async function logoutUser(token: string): Promise<void> {
  await (prisma as any).userSession.deleteMany({ where: { token } });
}

export async function getSessionNationId(token: string): Promise<string | null> {
  const session = await (prisma as any).userSession.findUnique({ where: { token } });
  if (!session) return null;
  if (new Date() > session.expiresAt) {
    await (prisma as any).userSession.delete({ where: { token } });
    return null;
  }
  return session.nationId ?? null;
}

// Ensures player1-5 User rows exist with correct bcrypt-hashed passwords.
// Called from ensureWorldInitialized at startup. Idempotent — skips existing users.
export async function ensureUsersInitialized(): Promise<void> {
  const players: Array<{ username: string; password: string }> = [
    { username: 'player1', password: 'war1' },
    { username: 'player2', password: 'war2' },
    { username: 'player3', password: 'war3' },
    { username: 'player4', password: 'war4' },
    { username: 'player5', password: 'war5' },
  ];

  for (const p of players) {
    const existing = await (prisma as any).user.findUnique({ where: { username: p.username } });
    const passwordHash = await hashPassword(p.password);
    if (!existing) {
      await (prisma as any).user.create({ data: { username: p.username, passwordHash } });
    } else if (existing.passwordHash.startsWith('$2b$12$placeholder')) {
      // Migration inserted a placeholder hash — replace with real hash.
      await (prisma as any).user.update({ where: { username: p.username }, data: { passwordHash } });
    }
  }
}
