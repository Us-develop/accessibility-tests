import { randomBytes } from 'crypto';
import {
  dbPool,
  dbDeleteUser,
  dbGetUserByEmail,
  dbGetUserById,
  dbUpsertProject,
  dbUpsertUser,
} from './db.js';
import { readJsonStore, writeJsonStore } from './json-store.mjs';
import { hashPassword, verifyPassword, isStrongPassword } from './passwords.mjs';
import { ensureFreeSubscription } from './billing.mjs';

const USERS_FILE = 'users.json';

const CONTACT_FIELDS = [
  'name',
  'phone',
  'company',
  'vatNumber',
  'addressLine1',
  'addressLine2',
  'city',
  'postalCode',
  'country',
];

function nowIso() {
  return new Date().toISOString();
}

function useDb() {
  return Boolean(dbPool);
}

function loadUsers() {
  const data = readJsonStore(USERS_FILE, { users: [] });
  return Array.isArray(data.users) ? data.users : [];
}

function saveUsers(users) {
  writeJsonStore(USERS_FILE, { users });
}

function emptyContact() {
  return {
    phone: '',
    company: '',
    vatNumber: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    postalCode: '',
    country: '',
  };
}

function withContactDefaults(user) {
  if (!user) return null;
  return { ...emptyContact(), ...user };
}

export function publicUser(user) {
  if (!user) return null;
  const {
    passwordHash,
    verifyToken,
    verifyExpiresAt,
    resetToken,
    resetExpiresAt,
    ...rest
  } = withContactDefaults(user);
  return rest;
}

function findByEmail(users, email) {
  const needle = String(email || '').trim().toLowerCase();
  return users.find((u) => u.email === needle) || null;
}

/**
 * Accounts created while Postgres was down live only in users.json.
 * Copy that row (and its projects) into Postgres the first time we look it up.
 */
async function hydrateJsonSidecar(user) {
  if (!user?.id || !useDb()) return;
  try {
    await ensureFreeSubscription(user.id);
  } catch (err) {
    console.warn('[users] free plan hydrate failed:', err?.message || err);
  }
  const data = readJsonStore('projects.json', { projects: [] });
  const projects = Array.isArray(data.projects) ? data.projects : [];
  for (const project of projects) {
    if (project?.userId !== user.id || !project.id || !project.domain) continue;
    try {
      await dbUpsertProject(project);
    } catch (err) {
      console.warn('[users] project hydrate failed:', err?.message || err);
    }
  }
}

async function hydrateJsonUser(fromJson) {
  if (!fromJson || !useDb()) return fromJson;
  await dbUpsertUser(fromJson);
  await hydrateJsonSidecar(fromJson);
  return withContactDefaults(await dbGetUserById(fromJson.id)) || fromJson;
}

export async function getUserById(id) {
  if (!id) return null;
  if (useDb()) {
    const fromDb = withContactDefaults(await dbGetUserById(id));
    if (fromDb) return fromDb;
    const fromJson = withContactDefaults(loadUsers().find((u) => u.id === id) || null);
    if (!fromJson) return null;
    return hydrateJsonUser(fromJson);
  }
  return withContactDefaults(loadUsers().find((u) => u.id === id) || null);
}

export async function getUserByEmail(email) {
  if (useDb()) {
    const fromDb = withContactDefaults(await dbGetUserByEmail(email));
    if (fromDb) return fromDb;
    const fromJson = withContactDefaults(findByEmail(loadUsers(), email));
    if (!fromJson) return null;
    return hydrateJsonUser(fromJson);
  }
  return withContactDefaults(findByEmail(loadUsers(), email));
}

export async function getPublicUserById(id) {
  return publicUser(await getUserById(id));
}

export async function persistUser(user) {
  if (useDb()) return withContactDefaults(await dbUpsertUser(user));
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx === -1) users.push(user);
  else users[idx] = user;
  saveUsers(users);
  return withContactDefaults(user);
}

export async function createUser({ email, password, name = '' }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
  }
  if (!isStrongPassword(password)) {
    throw Object.assign(new Error('Use a password of at least 10 characters.'), { status: 400 });
  }
  if (await getUserByEmail(normalized)) {
    throw Object.assign(new Error('An account with that email already exists.'), { status: 409 });
  }
  const autoVerify = String(process.env.AUTH_EMAIL_VERIFY || 'auto').toLowerCase() !== 'required';
  const user = {
    id: randomBytes(12).toString('hex'),
    email: normalized,
    name: String(name || '').trim().slice(0, 200),
    role: 'customer',
    passwordHash: await hashPassword(password),
    emailVerified: autoVerify,
    verifyToken: autoVerify ? null : randomBytes(16).toString('hex'),
    verifyExpiresAt: autoVerify ? null : new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    resetToken: null,
    resetExpiresAt: null,
    ...emptyContact(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  try {
    await persistUser(user);
  } catch (err) {
    if (err?.code === '23505') {
      throw Object.assign(new Error('An account with that email already exists.'), { status: 409 });
    }
    throw err;
  }
  await ensureFreeSubscription(user.id);
  return { user: publicUser(user), verifyToken: user.verifyToken };
}

export async function authenticateUser(email, password) {
  const user = await getUserByEmail(email);
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

export async function updateUser(id, patch) {
  const current = await getUserById(id);
  if (!current) return null;
  const next = { ...current, ...patch, id, updatedAt: nowIso() };
  return persistUser(next);
}

export async function updateContactDetails(userId, patch) {
  const allowed = {};
  for (const key of CONTACT_FIELDS) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, key)) {
      allowed[key] = String(patch[key] ?? '').trim().slice(0, 200);
    }
  }
  return publicUser(await updateUser(userId, allowed));
}

export async function verifyUserEmail(token) {
  if (!token) return null;
  let user = null;
  if (useDb()) {
    const { rows } = await dbPool.query(
      `SELECT id FROM users WHERE verify_token = $1 LIMIT 1`,
      [token]
    );
    if (rows[0]) user = await getUserById(rows[0].id);
  } else {
    user = loadUsers().find((u) => u.verifyToken && u.verifyToken === token) || null;
  }
  if (!user) return null;
  if (user.verifyExpiresAt && Date.parse(user.verifyExpiresAt) < Date.now()) return null;
  return publicUser(
    await updateUser(user.id, { emailVerified: true, verifyToken: null, verifyExpiresAt: null })
  );
}

export async function setPassword(id, password) {
  if (!isStrongPassword(password)) {
    throw Object.assign(new Error('Use a password of at least 10 characters.'), { status: 400 });
  }
  return publicUser(
    await updateUser(id, {
      passwordHash: await hashPassword(password),
      resetToken: null,
      resetExpiresAt: null,
    })
  );
}

export async function startPasswordReset(email) {
  const user = await getUserByEmail(email);
  if (!user) return null;
  const token = randomBytes(16).toString('hex');
  await updateUser(user.id, {
    resetToken: token,
    resetExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  });
  return { user: publicUser(user), token };
}

export async function consumePasswordReset(token) {
  if (!token) return null;
  if (useDb()) {
    const { rows } = await dbPool.query(
      `SELECT id FROM users WHERE reset_token = $1 LIMIT 1`,
      [token]
    );
    if (!rows[0]) return null;
    const user = await getUserById(rows[0].id);
    if (!user) return null;
    if (user.resetExpiresAt && Date.parse(user.resetExpiresAt) < Date.now()) return null;
    return user;
  }
  const user = loadUsers().find((u) => u.resetToken && u.resetToken === token) || null;
  if (!user) return null;
  if (user.resetExpiresAt && Date.parse(user.resetExpiresAt) < Date.now()) return null;
  return withContactDefaults(user);
}

export async function deleteUser(id) {
  if (useDb()) {
    await dbDeleteUser(id);
    return;
  }
  saveUsers(loadUsers().filter((u) => u.id !== id));
}

export function exportUserData(user) {
  return {
    account: publicUser(user),
    exportedAt: nowIso(),
  };
}
