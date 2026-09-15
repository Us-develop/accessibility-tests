import { randomBytes } from 'crypto';
import {
  dbPool,
  dbDeleteUser,
  dbGetUserByEmail,
  dbGetUserById,
  dbGetUserByPendingEmailToken,
  dbSetRunUserId,
  dbUpsertProject,
  dbUpsertUser,
  dbAnonymizeRunsForUser,
  dbDeleteLeadsByEmail,
  dbListLeadsByEmail,
} from './db.js';
import { readJsonStore, writeJsonStore } from './json-store.mjs';
import { hashPassword, verifyPassword, isStrongPassword } from './passwords.mjs';
import { ensureCustomerSubscription, ensureFreeSubscription, getSubscription } from './billing.mjs';
import { invalidateSessionUserCache } from './session.mjs';
import { cancelAndDeleteStripeCustomer } from './stripe.mjs';
import { ftpRemoveRunArtifacts } from './ftp.js';
import {
  deleteGuestBindingsForRuns,
  deleteLeadsByEmail,
  guestBindingsForRuns,
  leadsForEmail,
} from './guest.mjs';
import { deleteConsentsForAccount, listConsents, recordDeletionTombstone } from './consents.mjs';
import { deleteProjectsForUser, deleteRunDirectory, listRunRefsForUser } from './projects.mjs';
import { ensureFreebieLot } from './tokens.mjs';

export const GENERIC_CREDENTIALS_ERROR = 'Invalid username or password.';
export const SIGNUP_EMAIL_TAKEN_ERROR =
  'An account with this email already exists. Log in, or use a different email.';

function httpError(message, status, field) {
  return Object.assign(new Error(message), { status, ...(field ? { field } : {}) });
}

/** Dummy scrypt hash so missing users still pay the verifyPassword cost. */
const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$0123456789abcdef0123456789abcdef$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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

export const VAT_NUMBER_RE = /^[A-Z]{2}[A-Z0-9]{2,12}$/;

export function normalizeCustomerType(value) {
  return String(value || '').trim().toLowerCase() === 'business' ? 'business' : 'consumer';
}

export function normalizeVatNumber(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s.\-]/g, '');
  if (!raw) return '';
  if (!VAT_NUMBER_RE.test(raw)) {
    throw httpError('Enter a valid EU VAT number (for example BE0123456789).', 400, 'vatNumber');
  }
  return raw;
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
    customerType: 'consumer',
  };
}

function withContactDefaults(user) {
  if (!user) return null;
  const merged = { sessionVersion: 1, ...emptyContact(), ...user };
  merged.customerType = merged.customerType === 'business' ? 'business' : 'consumer';
  return merged;
}

function sessionVersionOf(user) {
  const n = Number(user?.sessionVersion);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function publicUser(user) {
  if (!user) return null;
  const {
    passwordHash,
    verifyToken,
    verifyExpiresAt,
    resetToken,
    resetExpiresAt,
    pendingEmailToken,
    pendingEmailExpiresAt,
    sessionVersion: _sessionVersion,
    ...rest
  } = withContactDefaults(user);
  return rest;
}

export function emailVerificationRequired() {
  const raw = String(process.env.AUTH_EMAIL_VERIFY || '').trim().toLowerCase();
  if (raw === 'required') return true;
  if (raw === 'auto' || raw === 'off' || raw === 'false' || raw === '0') return false;
  return process.env.NODE_ENV === 'production';
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
      const runIds = Array.isArray(project.runIds) ? project.runIds : [];
      for (const runId of runIds) {
        await dbSetRunUserId(project.domain, runId, user.id);
      }
    } catch (err) {
      console.warn('[users] project hydrate failed:', err?.message || err);
    }
  }
  try {
    await dbPool.query(
      `UPDATE runs r
          SET user_id = $1
         FROM projects p
        WHERE r.user_id IS NULL
          AND r.id = p.domain
          AND p.user_id = $1`,
      [user.id]
    );
  } catch (err) {
    console.warn('[users] run hydrate failed:', err?.message || err);
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

function assertBusinessCompany(customerType, company) {
  if (customerType === 'business' && !String(company || '').trim()) {
    throw httpError('Enter a company name for a business account.', 400, 'company');
  }
}

export async function createUser({
  email,
  password,
  name = '',
  company = '',
  vatNumber = '',
  customerType = 'consumer',
} = {}) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw httpError('Enter a valid email address.', 400, 'email');
  }
  if (!isStrongPassword(password)) {
    throw httpError('Use a password of at least 10 characters.', 400, 'password');
  }
  if (await getUserByEmail(normalized)) {
    throw httpError(SIGNUP_EMAIL_TAKEN_ERROR, 409, 'email');
  }
  const type = normalizeCustomerType(customerType);
  const companyName = String(company || '').trim().slice(0, 200);
  const vat = normalizeVatNumber(vatNumber);
  assertBusinessCompany(type, companyName);
  const autoVerify = !emailVerificationRequired();
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
    pendingEmail: null,
    pendingEmailToken: null,
    pendingEmailExpiresAt: null,
    sessionVersion: 1,
    ...emptyContact(),
    company: companyName,
    vatNumber: vat,
    customerType: type,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  try {
    await persistUser(user);
  } catch (err) {
    if (err?.code === '23505') {
      throw httpError(SIGNUP_EMAIL_TAKEN_ERROR, 409, 'email');
    }
    throw err;
  }
  await ensureCustomerSubscription(user.id, { emailVerified: user.emailVerified });
  return { user: publicUser(user), verifyToken: user.verifyToken };
}

export async function authenticateUser(email, password) {
  const user = await getUserByEmail(email);
  const hash = user?.passwordHash || DUMMY_PASSWORD_HASH;
  const ok = await verifyPassword(password, hash);
  return ok && user ? user : null;
}

export async function updateUser(id, patch) {
  const current = await getUserById(id);
  if (!current) return null;
  const next = { ...current, ...patch, id, updatedAt: nowIso(), sessionVersion: sessionVersionOf({ ...current, ...patch }) };
  const saved = await persistUser(next);
  invalidateSessionUserCache(id);
  return saved;
}

export async function updateContactDetails(userId, patch) {
  const allowed = {};
  for (const key of CONTACT_FIELDS) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, key)) {
      allowed[key] = String(patch[key] ?? '').trim().slice(0, 200);
    }
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'customerType')) {
    allowed.customerType = normalizeCustomerType(patch.customerType);
  } else if (patch && Object.prototype.hasOwnProperty.call(patch, 'buyingForBusiness')) {
    allowed.customerType =
      patch.buyingForBusiness === true ||
      patch.buyingForBusiness === 'on' ||
      patch.buyingForBusiness === 'true'
        ? 'business'
        : 'consumer';
  }
  if (Object.prototype.hasOwnProperty.call(allowed, 'vatNumber')) {
    allowed.vatNumber = normalizeVatNumber(allowed.vatNumber);
  }
  const current = await getUserById(userId);
  if (!current) return null;
  const nextType = allowed.customerType || current.customerType || 'consumer';
  const nextCompany = Object.prototype.hasOwnProperty.call(allowed, 'company')
    ? allowed.company
    : current.company;
  assertBusinessCompany(nextType, nextCompany);
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
  const saved = await updateUser(user.id, { emailVerified: true, verifyToken: null, verifyExpiresAt: null });
  await ensureFreebieLot(user.id);
  return publicUser(saved);
}

export async function setPassword(id, password) {
  if (!isStrongPassword(password)) {
    throw Object.assign(new Error('Use a password of at least 10 characters.'), { status: 400 });
  }
  const current = await getUserById(id);
  return publicUser(
    await updateUser(id, {
      passwordHash: await hashPassword(password),
      resetToken: null,
      resetExpiresAt: null,
      sessionVersion: sessionVersionOf(current) + 1,
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

export async function startEmailChange(userId, nextEmail, password) {
  const user = await getUserById(userId);
  if (!user) return null;
  const ok = await verifyPassword(String(password || ''), user.passwordHash);
  if (!ok) {
    throw Object.assign(new Error('Current password is incorrect.'), { status: 400 });
  }
  const normalized = String(nextEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
  }
  if (normalized === user.email) {
    throw Object.assign(new Error('That is already your email address.'), { status: 400 });
  }
  const taken = await getUserByEmail(normalized);
  if (taken && taken.id !== user.id) {
    throw httpError('That email is already in use.', 409, 'email');
  }
  const token = randomBytes(16).toString('hex');
  const saved = await updateUser(user.id, {
    pendingEmail: normalized,
    pendingEmailToken: token,
    pendingEmailExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  });
  return { user: publicUser(saved), token, previousEmail: user.email, pendingEmail: normalized };
}

export async function consumePendingEmailChange(token) {
  if (!token) return null;
  let user = null;
  if (useDb()) {
    user = withContactDefaults(await dbGetUserByPendingEmailToken(token));
  } else {
    user = withContactDefaults(loadUsers().find((u) => u.pendingEmailToken && u.pendingEmailToken === token) || null);
  }
  if (!user) return null;
  if (user.pendingEmailExpiresAt && Date.parse(user.pendingEmailExpiresAt) < Date.now()) return null;
  const nextEmail = String(user.pendingEmail || '').trim().toLowerCase();
  if (!nextEmail) return null;
  const taken = await getUserByEmail(nextEmail);
  if (taken && taken.id !== user.id) return null;
  const saved = await updateUser(user.id, {
    email: nextEmail,
    emailVerified: true,
    pendingEmail: null,
    pendingEmailToken: null,
    pendingEmailExpiresAt: null,
    sessionVersion: sessionVersionOf(user) + 1,
  });
  return { ...publicUser(saved), sessionVersion: sessionVersionOf(saved) };
}

function filterSidecar(file, key, predicate) {
  const data = readJsonStore(file, { [key]: [] });
  const rows = Array.isArray(data[key]) ? data[key] : [];
  writeJsonStore(file, { [key]: rows.filter(predicate) });
}

async function purgeUserSidecarStores(userId) {
  filterSidecar('subscriptions.json', 'subscriptions', (row) => row.userId !== userId);
  filterSidecar('usage.json', 'usage', (row) => row.userId !== userId);
  filterSidecar('payments.json', 'payments', (row) => row.userId !== userId);
  filterSidecar('token-lots.json', 'lots', (row) => row.userId !== userId);
  filterSidecar('projects.json', 'projects', (row) => row.userId !== userId);
}

export async function deleteAccount(userId) {
  const user = await getUserById(userId);
  if (!user) return false;
  const localSub = await getSubscription(userId);
  await cancelAndDeleteStripeCustomer(userId, localSub);
  const runRefs = await listRunRefsForUser(userId);
  if (useDb()) {
    const anonymized = await dbAnonymizeRunsForUser(userId);
    for (const row of anonymized) {
      if (!runRefs.some((ref) => ref.domain === row.domain && ref.runId === row.runId)) {
        runRefs.push(row);
      }
    }
  }
  for (const ref of runRefs) {
    deleteRunDirectory(ref.domain, ref.runId);
    await ftpRemoveRunArtifacts(ref.domain, ref.runId);
  }
  if (useDb()) await dbDeleteLeadsByEmail(user.email);
  deleteLeadsByEmail(user.email);
  deleteGuestBindingsForRuns(runRefs);
  await deleteConsentsForAccount({ userId, email: user.email });
  await recordDeletionTombstone(user.email);
  await deleteProjectsForUser(userId);
  await purgeUserSidecarStores(userId);
  await deleteUser(userId);
  console.info('[account] deleted user', userId);
  return true;
}

export async function deleteUser(id) {
  const current = await getUserById(id);
  if (current) {
    await updateUser(id, { sessionVersion: sessionVersionOf(current) + 1 });
  }
  invalidateSessionUserCache(id);
  if (useDb()) {
    await dbDeleteUser(id);
  }
  saveUsers(loadUsers().filter((u) => u.id !== id));
}

export async function exportUserData(user) {
  const runRefs = user?.id ? await listRunRefsForUser(user.id) : [];
  const byUser = user?.id ? await listConsents({ userId: user.id }) : [];
  const byEmail = user?.email ? await listConsents({ email: user.email }) : [];
  const seen = new Set();
  const consents = [];
  for (const row of [...byUser, ...byEmail]) {
    const key = row.id != null ? `id:${row.id}` : JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    consents.push(row);
  }
  let leads = [];
  if (user?.email) {
    leads = useDb() ? await dbListLeadsByEmail(user.email) : leadsForEmail(user.email);
  }
  return {
    account: publicUser(user),
    exportedAt: nowIso(),
    consents,
    leads,
    guestBindings: guestBindingsForRuns(runRefs),
  };
}
