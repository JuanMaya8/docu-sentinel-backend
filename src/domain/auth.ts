/**
 * Users and authentication, framework-free.
 *  - passwords: scrypt (N=16384, r=8, p=1) with a random 16-byte salt, compared in constant time
 *  - tokens: JWT HS256 signed with JWT_SECRET (node:crypto only, no extra dependency)
 *  - users live behind `UserRepository`; `BlobUserRepository` works on any BlobStore (files, memory or Postgres kv)
 */
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { BlobStore } from './blob-store';
import { DomainError, ValidationError } from './errors';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}
interface StoredUser extends User {
  passwordHash: string; // scrypt$<salt b64>$<hash b64>
}
export interface AuthSession {
  token: string;
  expiresAt: string;
  user: User;
}

export class InvalidCredentialsError extends DomainError {
  constructor() {
    super(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');
    this.name = 'InvalidCredentialsError';
  }
}
export class AuthRequiredError extends DomainError {
  constructor(reason = 'Inicia sesión para continuar.') {
    super(401, 'AUTH_REQUIRED', reason);
    this.name = 'AuthRequiredError';
  }
}

// ------------------------------------------------------------------ passwords

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ------------------------------------------------------------------ JWT (HS256)

const b64url = (b: Buffer | string): string => Buffer.from(b).toString('base64url');

export interface TokenClaims {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export function signToken(claims: Omit<TokenClaims, 'iat' | 'exp'>, secret: string, ttlSeconds: number, now = Date.now()): { token: string; exp: number } {
  const iat = Math.floor(now / 1000);
  const exp = iat + ttlSeconds;
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...claims, iat, exp }));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return { token: `${head}.${body}.${sig}`, exp };
}

/** Returns the claims or null when the token is malformed, badly signed or expired. */
export function verifyToken(token: string, secret: string, now = Date.now()): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')) as { alg?: string };
    if (header.alg !== 'HS256') return null;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenClaims;
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null;
    if (claims.exp * 1000 <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ users

export interface UserRepository {
  findByEmail(email: string): Promise<StoredUser | null>;
  findById(id: string): Promise<StoredUser | null>;
  create(user: StoredUser): Promise<void>;
}

const USERS_KEY = 'users.json';

/** All users in one JSON document (small user counts; writes serialised with a promise chain). */
export class BlobUserRepository implements UserRepository {
  private cache: StoredUser[] | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: BlobStore) {}

  private async all(): Promise<StoredUser[]> {
    if (!this.cache) {
      const raw = await this.store.read(USERS_KEY);
      try {
        this.cache = raw ? (JSON.parse(raw) as StoredUser[]) : [];
      } catch {
        this.cache = [];
      }
    }
    return this.cache;
  }
  async findByEmail(email: string): Promise<StoredUser | null> {
    return (await this.all()).find((u) => u.email === email) ?? null;
  }
  async findById(id: string): Promise<StoredUser | null> {
    return (await this.all()).find((u) => u.id === id) ?? null;
  }
  create(user: StoredUser): Promise<void> {
    const run = this.chain.then(async () => {
      const list = await this.all();
      if (list.some((u) => u.email === user.email)) throw new DomainError(409, 'EMAIL_TAKEN', 'Ya existe una cuenta con ese correo.');
      list.push(user);
      await this.store.write(USERS_KEY, JSON.stringify(list));
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export interface AuthOptions {
  secret: string;
  ttlHours: number;
  allowRegistration: boolean;
}

export class AuthService {
  constructor(private readonly users: UserRepository, private readonly opts: AuthOptions) {}

  private session(u: StoredUser): AuthSession {
    const { token, exp } = signToken({ sub: u.id, email: u.email }, this.opts.secret, Math.round(this.opts.ttlHours * 3600));
    return { token, expiresAt: new Date(exp * 1000).toISOString(), user: publicUser(u) };
  }

  async register(input: unknown): Promise<AuthSession> {
    if (!this.opts.allowRegistration) throw new DomainError(403, 'REGISTRATION_DISABLED', 'El registro de cuentas nuevas está desactivado.');
    const { email, password, name } = readCredentials(input, true);
    if (await this.users.findByEmail(email)) throw new DomainError(409, 'EMAIL_TAKEN', 'Ya existe una cuenta con ese correo.');
    const user: StoredUser = {
      id: `us_${randomBytes(6).toString('hex')}`,
      email,
      name: name || email.split('@')[0],
      createdAt: new Date().toISOString(),
      passwordHash: await hashPassword(password),
    };
    await this.users.create(user);
    return this.session(user);
  }

  async login(input: unknown): Promise<AuthSession> {
    const { email, password } = readCredentials(input, false);
    const user = await this.users.findByEmail(email);
    // always run scrypt so response time does not reveal whether the email exists
    const ok = await verifyPassword(password, user?.passwordHash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    if (!user || !ok) throw new InvalidCredentialsError();
    return this.session(user);
  }

  /** Bearer token -> user, or null. */
  async authenticate(token: string | undefined): Promise<User | null> {
    if (!token) return null;
    const claims = verifyToken(token, this.opts.secret);
    if (!claims) return null;
    const user = await this.users.findById(claims.sub);
    return user ? publicUser(user) : null;
  }
}

function publicUser(u: StoredUser): User {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt };
}

function readCredentials(input: unknown, registering: boolean): { email: string; password: string; name?: string } {
  const errors: string[] = [];
  const o = (typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const email = typeof o.email === 'string' ? o.email.trim().toLowerCase() : '';
  const password = typeof o.password === 'string' ? o.password : '';
  const name = typeof o.name === 'string' ? o.name.trim() : undefined;
  if (!EMAIL_RE.test(email)) errors.push('«email» debe ser un correo válido.');
  if (registering && (password.length < 8 || password.length > 200)) errors.push('«password» debe tener entre 8 y 200 caracteres.');
  if (!registering && (password.length === 0 || password.length > 200)) errors.push('«password» es obligatorio.');
  if (name !== undefined && name.length > 80) errors.push('«name» admite como máximo 80 caracteres.');
  if (errors.length) throw new ValidationError(errors);
  return { email, password, ...(name ? { name } : {}) };
}
