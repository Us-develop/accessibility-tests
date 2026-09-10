import { randomBytes } from 'crypto';
import { readJsonStore, writeJsonStore } from './json-store.mjs';
import { hashPassword, verifyPassword, isStrongPassword } from './passwords.mjs';

const USERS_FILE = 'users.json';

function nowIso() {
  return new Date().toISOString();
}

function loadUsers() {
  const data = readJsonStore(USERS_FILE, { users: [] });
  return Array.isArray(data.users) ? data.users : [];
}

function saveUsers(users) {
  writeJsonStore(USERS_FILE, { users });
}

function publicUser(user) {
  if (!user) return null;
  const {
    passwordHash,
    verifyToken,
    verifyExpiresAt,
    resetToken,
    resetExpiresAt,
    ...rest
  } = user;
  return rest;
}

function findByEmail(users, email) {
  const needle = String(email || '').trim().toLowerCase();
  return users.find((u) => u.email === needle) || null;
}

export function getUserById(id) {
  if (!id) return null;
  return loadUsers().find((u) => u.id === id) || null;
}

export function getUserByEmail(email) {
  return findByEmail(loadUsers(), email);
}

export function getPublicUserById(id) {
  return publicUser(getUserById(id));
}

export async function createUser({ email, password, name = '' }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
  }
  if (!isStrongPassword(password)) {
    throw Object.assign(new Error('Use a password of at least 10 characters.'), { status: 400 });
  }
  const users = loadUsers();
  if (findByEmail(users, normalized)) {
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
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  users.push(user);
  saveUsers(users);
  return { user: publicUser(user), verifyToken: user.verifyToken };
}

export async function authenticateUser(email, password) {
  const user = findByEmail(loadUsers(), email);
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

export function updateUser(id, patch) {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) return null;
  users[idx] = { ...users[idx], ...patch, updatedAt: nowIso() };
  saveUsers(users);
  return users[idx];
}

export function verifyUserEmail(token) {
  const users = loadUsers();
  const user = users.find((u) => u.verifyToken && u.verifyToken === token);
  if (!user) return null;
  if (user.verifyExpiresAt && Date.parse(user.verifyExpiresAt) < Date.now()) return null;
  return publicUser(
    updateUser(user.id, { emailVerified: true, verifyToken: null, verifyExpiresAt: null })
  );
}

export async function setPassword(id, password) {
  if (!isStrongPassword(password)) {
    throw Object.assign(new Error('Use a password of at least 10 characters.'), { status: 400 });
  }
  return publicUser(updateUser(id, { passwordHash: await hashPassword(password), resetToken: null, resetExpiresAt: null }));
}

export function startPasswordReset(email) {
  const user = findByEmail(loadUsers(), email);
  if (!user) return null;
  const token = randomBytes(16).toString('hex');
  updateUser(user.id, {
    resetToken: token,
    resetExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  });
  return { user: publicUser(user), token };
}

export function consumePasswordReset(token) {
  const users = loadUsers();
  const user = users.find((u) => u.resetToken && u.resetToken === token);
  if (!user) return null;
  if (user.resetExpiresAt && Date.parse(user.resetExpiresAt) < Date.now()) return null;
  return user;
}

export function deleteUser(id) {
  const users = loadUsers().filter((u) => u.id !== id);
  saveUsers(users);
}

export function exportUserData(user) {
  return {
    account: publicUser(user),
    exportedAt: nowIso(),
  };
}
