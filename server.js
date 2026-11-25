const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 10000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'grow_admin_2026';

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// ============================================================================
// 1. FIREBASE ADMIN SDK & FIRESTORE SETUP
// ============================================================================
let db = null;
let firebaseReady = false;

function initFirebase() {
  try {
    if (admin.apps.length) {
      db = admin.firestore();
      firebaseReady = true;
      return;
    }

    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawServiceAccount) {
      console.warn('[Firebase] FIREBASE_SERVICE_ACCOUNT env missing. Using in-memory store.');
      return;
    }

    const parsed =
      typeof rawServiceAccount === 'string'
        ? JSON.parse(rawServiceAccount)
        : rawServiceAccount;

    if (parsed.private_key && typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }

    admin.initializeApp({
      credential: admin.credential.cert(parsed),
      projectId: parsed.project_id || process.env.FIREBASE_PROJECT_ID || 'grow-b17db',
    });

    db = admin.firestore();
    firebaseReady = true;
    console.log('[Firebase] Initialized project:', parsed.project_id || 'grow-b17db');
  } catch (err) {
    console.error('[Firebase] Init failed, falling back to memory:', err.message);
    firebaseReady = false;
  }
}

initFirebase();

// ============================================================================
// 2. CENTRALIZED IN-MEMORY STATE & FIRESTORE SYNC HELPERS
// ============================================================================
const store = {
  config: {
    brandName: 'GROWTHWAVE CAPITAL',
    inviteBonus: 15,
    inviteBonusAmount: 15,
    dailyCheckinBonus: 5,
    minRecharge: 100,
    minWithdraw: 120,
    withdrawFeePercent: 0,
    upiId: '',
    customServiceLink: '',
    qrCodeImage: '',
    popupBanner: '',
    homeBanner: '',
    updatedAt: new Date().toISOString(),
  },
  users: new Map(),       // userId -> user object
  recharges: [],          // recharge transactions
  withdrawals: [],        // withdrawal transactions
  products: [],           // investment plans
  purchases: [],          // user active/past plan investments
  promos: new Map(),        // CODE -> promo object
  chats: new Map(),         // userId -> array of messages
  checkins: new Map(),      // userId -> { lastClaimDate, totalClaimed }
  liveCode: {
    connectedSite: null,
    latestPublish: null,
  },
};

const INTERVAL_MS = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  'daily': 24 * 60 * 60 * 1000,
};

const ALLOWED_INTERVALS = Object.keys(INTERVAL_MS);

function toNum(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function syncDoc(collectionName, docId, payload) {
  if (!firebaseReady || !db || !docId) return;
  try {
    await db.collection(collectionName).doc(String(docId)).set(payload, { merge: true });
  } catch (err) {
    console.warn(`[Firestore Sync Warning] ${collectionName}/${docId}:`, err.message);
  }
}

async function deleteDocSafe(collectionName, docId) {
  if (!firebaseReady || !db || !docId) return;
  try {
    await db.collection(collectionName).doc(String(docId)).delete();
  } catch (err) {
    console.warn(`[Firestore Delete Warning] ${collectionName}/${docId}:`, err.message);
  }
}

async function hydrateFromFirestore() {
  if (!firebaseReady || !db) return;
  try {
    const cfgSnap = await db.collection('app_config').doc('main').get();
    if (cfgSnap.exists) {
      store.config = { ...store.config, ...cfgSnap.data() };
    }

    const usersSnap = await db.collection('users').get();
    usersSnap.forEach((doc) => {
      const data = doc.data();
      const uid = String(data.userId || doc.id);
      store.users.set(uid, {
        userId: uid,
        uid,
        phone: data.phone || '',
        invitedBy: data.invitedBy || '',
        invitesCount: toNum(data.invitesCount, 0),
        chargedBalance: toNum(data.chargedBalance, 0),
        withdrawalBalance: toNum(data.withdrawalBalance, 0),
        withdrawPassword: data.withdrawPassword || '',
        vipLevel: toNum(data.vipLevel, 0),
        createdAt: data.createdAt || nowIso(),
      });
    });

    const recSnap = await db.collection('recharges').get();
    const recList = [];
    recSnap.forEach((doc) => recList.push(doc.data()));
    recList.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (recList.length) store.recharges = recList;

    const wdSnap = await db.collection('withdrawals').get();
    const wdList = [];
    wdSnap.forEach((doc) => wdList.push(doc.data()));
    wdList.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (wdList.length) store.withdrawals = wdList;

    const prodSnap = await db.collection('products').get();
    const prodList = [];
    prodSnap.forEach((doc) => prodList.push(doc.data()));
    prodList.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (prodList.length) store.products = prodList;

    const purSnap = await db.collection('purchases').get();
    const purList = [];
    purSnap.forEach((doc) => purList.push(doc.data()));
    if (purList.length) store.purchases = purList;

    const promoSnap = await db.collection('promos').get();
    promoSnap.forEach((doc) => {
      const p = doc.data();
      const code = String(p.code || doc.id).toUpperCase();
      store.promos.set(code, { ...p, code });
    });

    const chatSnap = await db.collection('chats').get();
    chatSnap.forEach((doc) => {
      const c = doc.data();
      const uid = String(c.userId || doc.id);
      store.chats.set(uid, Array.isArray(c.messages) ? c.messages : []);
    });

    const siteSnap = await db.collection('live_code').doc('site').get();
    if (siteSnap.exists) store.liveCode.connectedSite = siteSnap.data();

    const latestCodeSnap = await db.collection('live_code').doc('latest').get();
    if (latestCodeSnap.exists) store.liveCode.latestPublish = latestCodeSnap.data();

    console.log(
      `[Firestore Hydrated] Users: ${store.users.size}, Recharges: ${store.recharges.length}, Withdrawals: ${store.withdrawals.length}, Products: ${store.products.length}`
    );
  } catch (err) {
    console.warn('[Firestore Hydrate Warning]:', err.message);
  }
}

function ensureUser(userId, extra = {}) {
  const cleanId = String(userId || '').trim();
  const id = cleanId || `UID_${Date.now()}`;

  if (!store.users.has(id)) {
    store.users.set(id, {
      userId: id,
      uid: id,
      phone: extra.phone ? String(extra.phone).trim() : '',
      invitedBy: extra.invitedBy ? String(extra.invitedBy).trim() : '',
      invitesCount: 0,
      chargedBalance: 0,
      withdrawalBalance: 0,
      withdrawPassword: extra.withdrawPassword ? String(extra.withdrawPassword) : '',
      vipLevel: 0,
      createdAt: nowIso(),
    });
  }

  const user = store.users.get(id);
  if (extra.phone && !user.phone) user.phone = String(extra.phone).trim();
  if (extra.invitedBy && !user.invitedBy) user.invitedBy = String(extra.invitedBy).trim();
  if (extra.withdrawPassword) user.withdrawPassword = String(extra.withdrawPassword);
  return user;
}

// ============================================================================
// 3. ADMIN AUTHENTICATION MIDDLEWARE
// ============================================================================
function requireAdmin(req, res, next) {
  const provided =
    req.headers['x-admin-secret'] ||
    req.headers['authorization']?.replace(/^Bearer\s+/i, '') ||
    req.body?.adminSecret ||
    req.query?.adminSecret;

  if (!ADMIN_SECRET || provided !== ADMIN_SECRET) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid or missing x-admin-secret',
    });
  }
  next();
}

// ============================================================================
// 4. HEALTH & APP CONFIG ROUTES
// ============================================================================
app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'Grow Complete Backend API',
    status: 'online',
    firebaseConnected: firebaseReady,
    timestamp: nowIso(),
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    firebaseConnected: firebaseReady,
    timestamp: nowIso(),
  });
});

app.get('/api/app/config', (req, res) => {
  res.json({
    success: true,
    config: store.config,
    data: store.config,
  });
});

app.post('/api/admin/config', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const bonus = toNum(b.inviteBonus ?? b.inviteBonusAmount, store.config.inviteBonus);

  store.config = {
    ...store.config,
    ...b,
    inviteBonus: bonus,
    inviteBonusAmount: bonus,
    dailyCheckinBonus: toNum(b.dailyCheckinBonus, store.config.dailyCheckinBonus),
    minRecharge: toNum(b.minRecharge, store.config.minRecharge),
    minWithdraw: toNum(b.minWithdraw, store.config.minWithdraw),
    withdrawFeePercent: toNum(b.withdrawFeePercent, store.config.withdrawFeePercent),
    updatedAt: nowIso(),
  };

  await syncDoc('app_config', 'main', store.config);
  res.json({
    success: true,
    message: 'Configuration saved successfully',
    config: store.config,
    data: store.config,
  });
});

// ============================================================================
// 5. AUTH, USER PROFILE, INVITE BONUS & DAILY CHECK-IN
// ============================================================================
app.post('/api/auth/register-or-login', async (req, res) => {
  const { userId, uid, phone, invitedBy, withdrawPassword } = req.body || {};
  const id = String(userId || uid || phone || '').trim();
  if (!id) {
    return res.status(400).json({ success: false, message: 'userId or phone is required' });
  }

  const existedBefore = store.users.has(id);
  const user = ensureUser(id, { phone, invitedBy, withdrawPassword });

  if (!existedBefore && invitedBy) {
    const inviterId = String(invitedBy).trim();
    if (inviterId && inviterId !== id && store.users.has(inviterId)) {
      const inviter = store.users.get(inviterId);
      inviter.invitesCount = toNum(inviter.invitesCount, 0) + 1;
      const bonusAmt = toNum(store.config.inviteBonus ?? store.config.inviteBonusAmount, 0);
      if (bonusAmt > 0) {
        inviter.withdrawalBalance = toNum(inviter.withdrawalBalance, 0) + bonusAmt;
      }
      await syncDoc('users', inviter.userId, inviter);
    }
  }

  await syncDoc('users', user.userId, user);
  res.json({
    success: true,
    isNewUser: !existedBefore,
    user,
    data: user,
  });
});

app.get('/api/user/:userId', (req, res) => {
  const uid = String(req.params.userId || '').trim();
  if (!uid) {
    return res.status(400).json({ success: false, message: 'userId is required' });
  }
  const user = ensureUser(uid);
  res.json({ success: true, user, data: user });
});

app.post('/api/user/set-withdraw-password', async (req, res) => {
  const { userId, uid, withdrawPassword, password } = req.body || {};
  const targetId = String(userId || uid || '').trim();
  const pwd = String(withdrawPassword || password || '').trim();

  if (!targetId || !pwd) {
    return res.status(400).json({ success: false, message: 'userId and withdrawPassword required' });
  }

  const user = ensureUser(targetId);
  user.withdrawPassword = pwd;
  await syncDoc('users', user.userId, user);
  res.json({ success: true, message: 'Withdraw password updated', user });
});

app.get('/api/checkin/status/:userId', (req, res) => {
  const uid = String(req.params.userId || '').trim();
  const rec = store.checkins.get(uid) || { lastClaimDate: null, totalClaimed: 0 };
  res.json({
    success: true,
    claimedToday: rec.lastClaimDate === todayKey(),
    rewardAmount: toNum(store.config.dailyCheckinBonus, 5),
    data: rec,
  });
});

app.post('/api/checkin/claim', async (req, res) => {
  const { userId, uid } = req.body || {};
  const targetId = String(userId || uid || '').trim();
  if (!targetId) {
    return res.status(400).json({ success: false, message: 'userId is required' });
  }

  const today = todayKey();
  const rec = store.checkins.get(targetId) || { lastClaimDate: null, totalClaimed: 0 };
  if (rec.lastClaimDate === today) {
    return res.status(400).json({ success: false, message: 'Daily check-in already claimed today' });
  }

  const reward = toNum(store.config.dailyCheckinBonus, 5);
  const user = ensureUser(targetId);
  user.withdrawalBalance = toNum(user.withdrawalBalance, 0) + reward;

  const updatedCheckin = {
    userId: targetId,
    lastClaimDate: today,
    totalClaimed: toNum(rec.totalClaimed, 0) + reward,
    updatedAt: nowIso(),
  };
  store.checkins.set(targetId, updatedCheckin);

  await syncDoc('users', user.userId, user);
  await syncDoc('checkins', targetId, updatedCheckin);

  res.json({
    success: true,
    message: `Claimed ₹${reward} daily check-in bonus`,
    reward,
    user,
  });
});

// ============================================================================
// 6. ADMIN OVERVIEW, USERS & DIRECT BONUS
// ============================================================================
app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const usersList = Array.from(store.users.values());
  const chargedPool = usersList.reduce((acc, u) => acc + toNum(u.chargedBalance, 0), 0);
  const withdrawPool = usersList.reduce((acc, u) => acc + toNum(u.withdrawalBalance, 0), 0);
  const approvedRecharge = store.recharges
    .filter((r) => String(r.status).toLowerCase() === 'approved')
    .reduce((acc, r) => acc + toNum(r.amount, 0), 0);
  const totalWithdraw = store.withdrawals
    .filter((w) => String(w.status).toLowerCase() === 'approved')
    .reduce((acc, w) => acc + toNum(w.amount, 0), 0);
  const totalInvites = usersList.reduce((acc, u) => acc + toNum(u.invitesCount, 0), 0);
  const inviteBonus = totalInvites * toNum(store.config.inviteBonus ?? store.config.inviteBonusAmount, 0);

  const summary = {
    totalUsers: usersList.length,
    chargedPool,
    withdrawPool,
    approvedRecharge,
    totalWithdraw,
    inviteBonus,
    pendingRecharges: store.recharges.filter((r) => String(r.status).toLowerCase() === 'pending').length,
    pendingWithdrawals: store.withdrawals.filter((w) => String(w.status).toLowerCase() === 'pending').length,
  };

  res.json({ success: true, data: summary, ...summary });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = Array.from(store.users.values());
  res.json({ success: true, users, data: users });
});

app.post('/api/admin/bonus/uid', requireAdmin, async (req, res) => {
  const { uid, userId, amount, balanceTarget } = req.body || {};
  const targetId = String(uid || userId || '').trim();
  const amt = Number(amount);

  if (!targetId || !Number.isFinite(amt) || amt === 0) {
    return res.status(400).json({ success: false, message: 'Valid uid and non-zero amount required' });
  }

  const user = ensureUser(targetId);
  const targetField = balanceTarget === 'chargedBalance' ? 'chargedBalance' : 'withdrawalBalance';
  user[targetField] = toNum(user[targetField], 0) + amt;

  await syncDoc('users', user.userId, user);
  res.json({
    success: true,
    message: `Added ₹${amt} to ${targetId} (${targetField})`,
    user,
  });
});

app.post('/api/admin/user/balance', requireAdmin, async (req, res) => {
  const { uid, userId, chargedBalance, withdrawalBalance, vipLevel } = req.body || {};
  const targetId = String(uid || userId || '').trim();
  if (!targetId) {
    return res.status(400).json({ success: false, message: 'userId is required' });
  }

  const user = ensureUser(targetId);
  if (chargedBalance !== undefined) user.chargedBalance = toNum(chargedBalance, user.chargedBalance);
  if (withdrawalBalance !== undefined) user.withdrawalBalance = toNum(withdrawalBalance, user.withdrawalBalance);
  if (vipLevel !== undefined) user.vipLevel = toNum(vipLevel, user.vipLevel);

  await syncDoc('users', user.userId, user);
  res.json({ success: true, message: 'User balance updated', user });
});

// ============================================================================
// 7. RECHARGE MANAGEMENT (USER CREATE + ADMIN DIRECT & APPROVE/REJECT)
// ============================================================================
app.post('/api/recharge/create', async (req, res) => {
  const { userId, uid, amount, utr, channel } = req.body || {};
  const targetId = String(userId || uid || '').trim();
  const amt = Number(amount);

  if (!targetId || !Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ success: false, message: 'Valid userId and positive amount required' });
  }

  const user = ensureUser(targetId);
  const recId = `REC_${Date.now()}`;
  const rec = {
    rechargeId: recId,
    id: recId,
    userId: targetId,
    phone: user.phone || '',
    amount: amt,
    utr: String(utr || '').trim(),
    channel: String(channel || 'UPI_QR').trim(),
    status: 'pending',
    createdAt: nowIso(),
  };

  store.recharges.unshift(rec);
  await syncDoc('recharges', recId, rec);
  res.json({ success: true, message: 'Recharge request submitted', recharge: rec });
});

app.get('/api/recharges/user/:userId', (req, res) => {
  const uid = String(req.params.userId || '').trim();
  const list = store.recharges.filter((r) => String(r.userId) === uid);
  res.json({ success: true, recharges: list, data: list });
});

app.get('/api/admin/recharges', requireAdmin, (req, res) => {
  res.json({ success: true, recharges: store.recharges, data: store.recharges });
});

app.post('/api/admin/recharge/uid', requireAdmin, async (req, res) => {
  const { uid, userId, amount, channel } = req.body || {};
  const targetId = String(uid || userId || '').trim();
  const amt = Number(amount);

  if (!targetId || !Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ success: false, message: 'Valid uid and positive amount required' });
  }

  const user = ensureUser(targetId);
  user.chargedBalance = toNum(user.chargedBalance, 0) + amt;

  const recId = `REC_${Date.now()}`;
  const rec = {
    rechargeId: recId,
    id: recId,
    userId: targetId,
    phone: user.phone || '',
    amount: amt,
    utr: '',
    channel: String(channel || 'ADMIN_DIRECT').trim(),
    status: 'approved',
    createdAt: nowIso(),
  };

  store.recharges.unshift(rec);
  await syncDoc('users', user.userId, user);
  await syncDoc('recharges', recId, rec);
  res.json({ success: true, message: 'Direct recharge credited', recharge: rec, user });
});

app.post('/api/admin/recharge/action', requireAdmin, async (req, res) => {
  const { rechargeId, id, action } = req.body || {};
  const recId = String(rechargeId || id || '').trim();
  const act = String(action || '').toLowerCase();

  const rec = store.recharges.find((r) => String(r.rechargeId || r.id) === recId);
  if (!rec) {
    return res.status(404).json({ success: false, message: 'Recharge request not found' });
  }
  if (String(rec.status).toLowerCase() !== 'pending') {
    return res.status(400).json({ success: false, message: `Recharge already ${rec.status}` });
  }

  if (act === 'approve') {
    rec.status = 'approved';
    const user = ensureUser(rec.userId);
    user.chargedBalance = toNum(user.chargedBalance, 0) + toNum(rec.amount, 0);
    await syncDoc('users', user.userId, user);
  } else if (act === 'reject') {
    rec.status = 'rejected';
  } else {
    return res.status(400).json({ success: false, message: 'Action must be approve or reject' });
  }

  rec.updatedAt = nowIso();
  await syncDoc('recharges', recId, rec);
  res.json({ success: true, message: `Recharge ${rec.status}`, recharge: rec });
});

// ============================================================================
// 8. WITHDRAWAL MANAGEMENT (USER CREATE + ADMIN APPROVE/REJECT + AUTO REFUND)
// ============================================================================
async function handleCreateWithdrawal(req, res) {
  const {
    userId,
    uid,
    amount,
    upiId,
    bankAccount,
    accountNumber,
    ifsc,
    holderName,
    method,
    withdrawPassword,
  } = req.body || {};

  const targetId = String(userId || uid || '').trim();
  const amt = Number(amount);

  if (!targetId || !Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ success: false, message: 'Valid userId and positive amount required' });
  }

  const user = ensureUser(targetId);
  if (user.withdrawPassword && withdrawPassword && String(user.withdrawPassword) !== String(withdrawPassword)) {
    return res.status(400).json({ success: false, message: 'Invalid withdraw password' });
  }

  const currentBal = toNum(user.withdrawalBalance, 0);
  if (currentBal < amt) {
    return res.status(400).json({ success: false, message: 'Insufficient withdrawal balance' });
  }

  const feePct = toNum(store.config.withdrawFeePercent, 0);
  const feeAmount = Number(((amt * feePct) / 100).toFixed(2));
  const netPayable = Number((amt - feeAmount).toFixed(2));

  user.withdrawalBalance = Number((currentBal - amt).toFixed(2));
  const wdId = `WD_${Date.now()}`;

  const wd = {
    withdrawalId: wdId,
    id: wdId,
    userId: targetId,
    phone: user.phone || '',
    amount: amt,
    feeAmount,
    netPayable,
    upiId: String(upiId || '').trim(),
    accountNumber: String(accountNumber || bankAccount || '').trim(),
    ifsc: String(ifsc || '').trim(),
    holderName: String(holderName || '').trim(),
    method: method || (upiId ? 'UPI' : 'BANK'),
    status: 'pending',
    createdAt: nowIso(),
  };

  store.withdrawals.unshift(wd);
  await syncDoc('users', user.userId, user);
  await syncDoc('withdrawals', wdId, wd);

  res.json({
    success: true,
    message: 'Withdrawal request submitted',
    withdrawal: wd,
    user,
  });
}

app.post('/api/withdraw/auto-upi', handleCreateWithdrawal);
app.post('/api/withdraw/create', handleCreateWithdrawal);

app.get('/api/withdrawals/user/:userId', (req, res) => {
  const uid = String(req.params.userId || '').trim();
  const list = store.withdrawals.filter((w) => String(w.userId) === uid);
  res.json({ success: true, withdrawals: list, data: list });
});

app.get('/api/admin/withdrawals', requireAdmin, (req, res) => {
  res.json({ success: true, withdrawals: store.withdrawals, data: store.withdrawals });
});

app.post('/api/admin/withdraw/action', requireAdmin, async (req, res) => {
  const { withdrawalId, id, action } = req.body || {};
  const wdId = String(withdrawalId || id || '').trim();
  const act = String(action || '').toLowerCase();

  const wd = store.withdrawals.find((w) => String(w.withdrawalId || w.id) === wdId);
  if (!wd) {
    return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
  }
  if (String(wd.status).toLowerCase() !== 'pending') {
    return res.status(400).json({ success: false, message: `Withdrawal already ${wd.status}` });
  }

  if (act === 'approve') {
    wd.status = 'approved';
  } else if (act === 'reject') {
    wd.status = 'rejected';
    const user = ensureUser(wd.userId);
    user.withdrawalBalance = Number((toNum(user.withdrawalBalance, 0) + toNum(wd.amount, 0)).toFixed(2));
    await syncDoc('users', user.userId, user);
  } else {
    return res.status(400).json({ success: false, message: 'Action must be approve or reject' });
  }

  wd.updatedAt = nowIso();
  await syncDoc('withdrawals', wdId, wd);

  res.json({
    success: true,
    message: act === 'reject' ? 'Withdrawal rejected and amount refunded to user' : 'Withdrawal approved',
    withdrawal: wd,
  });
});

// ============================================================================
// 9. PRODUCTS / PLANS, BUY & INTERVAL INCOME CLAIM
// ============================================================================
app.get('/api/products', (req, res) => {
  res.json({ success: true, products: store.products, data: store.products });
});

app.post('/api/admin/products/add', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const interval = ALLOWED_INTERVALS.includes(b.payoutInterval) ? b.payoutInterval : 'daily';
  const prodId = `PRD_${Date.now()}`;

  const product = {
    productId: prodId,
    id: prodId,
    name: String(b.name || 'Investment Plan').trim(),
    price: toNum(b.price, 0),
    dailyIncome: toNum(b.dailyIncome, 0),
    durationDays: toNum(b.durationDays, 30),
    vipLevel: toNum(b.vipLevel, 0),
    payoutInterval: interval,
    image: String(b.image || '').trim(),
    createdAt: nowIso(),
  };

  store.products.unshift(product);
  await syncDoc('products', prodId, product);
  res.json({ success: true, message: 'Product added', product });
});

app.post('/api/admin/products/remove', requireAdmin, async (req, res) => {
  const { productId, id } = req.body || {};
  const targetId = String(productId || id || '').trim();
  const before = store.products.length;
  store.products = store.products.filter((p) => String(p.productId || p.id) !== targetId);

  if (store.products.length === before) {
    return res.status(404).json({ success: false, message: 'Product not found' });
  }

  await deleteDocSafe('products', targetId);
  res.json({ success: true, message: 'Product removed' });
});

app.post('/api/products/buy', async (req, res) => {
  const { userId, uid, productId, id } = req.body || {};
  const targetId = String(userId || uid || '').trim();
  const prodKey = String(productId || id || '').trim();

  const product = store.products.find((p) => String(p.productId || p.id) === prodKey);
  if (!targetId || !product) {
    return res.status(404).json({ success: false, message: 'User or product not found' });
  }

  const user = ensureUser(targetId);
  if (toNum(user.vipLevel, 0) < toNum(product.vipLevel, 0)) {
    return res.status(400).json({ success: false, message: `Requires VIP level ${product.vipLevel}` });
  }

  const price = toNum(product.price, 0);
  if (toNum(user.chargedBalance, 0) < price) {
    return res.status(400).json({ success: false, message: 'Insufficient charged balance' });
  }

  user.chargedBalance = Number((toNum(user.chargedBalance, 0) - price).toFixed(2));
  const purchaseId = `BUY_${Date.now()}`;

  const purchase = {
    purchaseId,
    id: purchaseId,
    userId: targetId,
    productId: product.productId,
    name: product.name,
    price,
    dailyIncome: toNum(product.dailyIncome, 0),
    durationDays: toNum(product.durationDays, 30),
    payoutInterval: product.payoutInterval || 'daily',
    lastClaimAt: Date.now(),
    totalClaimed: 0,
    createdAt: nowIso(),
  };

  store.purchases.unshift(purchase);
  await syncDoc('users', user.userId, user);
  await syncDoc('purchases', purchaseId, purchase);

  res.json({ success: true, message: 'Plan purchased successfully', purchase, user });
});

app.post('/api/products/claim', async (req, res) => {
  const { userId, uid, purchaseId, id } = req.body || {};
  const targetId = String(userId || uid || '').trim();
  const purKey = String(purchaseId || id || '').trim();

  const p = store.purchases.find(
    (item) => String(item.purchaseId || item.id) === purKey && String(item.userId) === targetId
  );
  if (!p) {
    return res.status(404).json({ success: false, message: 'Purchase record not found' });
  }

  const stepMs = INTERVAL_MS[p.payoutInterval] || INTERVAL_MS.daily;
  const now = Date.now();
  const elapsed = now - toNum(p.lastClaimAt, now);
  const cycles = Math.floor(elapsed / stepMs);

  if (cycles < 1) {
    return res.status(400).json({ success: false, message: 'Payout interval time has not completed yet' });
  }

  const payoutAmt = Number((cycles * toNum(p.dailyIncome, 0)).toFixed(2));
  p.lastClaimAt = toNum(p.lastClaimAt, now) + cycles * stepMs;
  p.totalClaimed = Number((toNum(p.totalClaimed, 0) + payoutAmt).toFixed(2));

  const user = ensureUser(targetId);
  user.withdrawalBalance = Number((toNum(user.withdrawalBalance, 0) + payoutAmt).toFixed(2));

  await syncDoc('users', user.userId, user);
  await syncDoc('purchases', p.purchaseId, p);

  res.json({
    success: true,
    message: `Claimed ₹${payoutAmt} (${cycles} cycle${cycles > 1 ? 's' : ''})`,
    reward: payoutAmt,
    user,
  });
});

app.get('/api/purchases/user/:userId', (req, res) => {
  const uid = String(req.params.userId || '').trim();
  const list = store.purchases.filter((item) => String(item.userId) === uid);
  res.json({ success: true, purchases: list, data: list });
});

// ============================================================================
// 10. PROMO CODES
// ============================================================================
app.post('/api/admin/promo/create', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').trim().toUpperCase();
  if (!code) {
    return res.status(400).json({ success: false, message: 'Promo code is required' });
  }

  const promo = {
    code,
    rewardAmount: toNum(b.rewardAmount, 0),
    balanceTarget: b.balanceTarget === 'chargedBalance' ? 'chargedBalance' : 'withdrawalBalance',
    maxUses: toNum(b.maxUses, 100),
    usedCount: 0,
    usedBy: [],
    requiredVipLevel: toNum(b.requiredVipLevel, 0),
    expiresAt: b.expiresAt || null,
    createdAt: nowIso(),
  };

  store.promos.set(code, promo);
  await syncDoc('promos', code, promo);
  res.json({ success: true, message: `Promo code ${code} created`, promo });
});

app.get('/api/admin/promos', requireAdmin, (req, res) => {
  const promos = Array.from(store.promos.values());
  res.json({ success: true, promos, data: promos });
});

app.post('/api/promo/redeem', async (req, res) => {
  const { userId, uid, code } = req.body || {};
  const targetId = String(userId || uid || '').trim();
  const cleanCode = String(code || '').trim().toUpperCase();

  if (!targetId || !cleanCode) {
    return res.status(400).json({ success: false, message: 'userId and promo code are required' });
  }

  const user = ensureUser(targetId);
  const promo = store.promos.get(cleanCode);
  if (!promo) {
    return res.status(404).json({ success: false, message: 'Invalid promo code' });
  }
  if (promo.expiresAt && Date.now() > new Date(promo.expiresAt).getTime()) {
    return res.status(400).json({ success: false, message: 'Promo code expired' });
  }
  if (toNum(promo.usedCount, 0) >= toNum(promo.maxUses, 100)) {
    return res.status(400).json({ success: false, message: 'Promo code usage limit reached' });
  }
  if (toNum(user.vipLevel, 0) < toNum(promo.requiredVipLevel, 0)) {
    return res.status(400).json({ success: false, message: `Requires VIP level ${promo.requiredVipLevel}` });
  }
  if (Array.isArray(promo.usedBy) && promo.usedBy.includes(user.userId)) {
    return res.status(400).json({ success: false, message: 'You have already redeemed this promo code' });
  }

  promo.usedCount = toNum(promo.usedCount, 0) + 1;
  promo.usedBy = Array.isArray(promo.usedBy) ? [...promo.usedBy, user.userId] : [user.userId];
  const reward = toNum(promo.rewardAmount, 0);
  user[promo.balanceTarget] = Number((toNum(user[promo.balanceTarget], 0) + reward).toFixed(2));

  await syncDoc('promos', cleanCode, promo);
  await syncDoc('users', user.userId, user);

  res.json({
    success: true,
    message: `Promo ${cleanCode} redeemed for ₹${reward}`,
    reward,
    user,
  });
});

// ============================================================================
// 11. LIVE CUSTOMER SERVICE CHAT
// ============================================================================
app.get('/api/service/chat/:userId', (req, res) => {
  const uid = String(req.params.userId || '').trim();
  const messages = store.chats.get(uid) || [];
  res.json({ success: true, messages, data: messages });
});

app.post('/api/service/chat/send', async (req, res) => {
  const { userId, uid, message, text } = req.body || {};
  const targetId = String(userId || uid || '').trim();
  const bodyText = String(message || text || '').trim();

  if (!targetId || !bodyText) {
    return res.status(400).json({ success: false, message: 'userId and message are required' });
  }

  ensureUser(targetId);
  const messages = store.chats.get(targetId) || [];
  messages.push({
    sender: 'user',
    text: bodyText,
    createdAt: nowIso(),
  });
  store.chats.set(targetId, messages);
  await syncDoc('chats', targetId, { userId: targetId, messages, updatedAt: nowIso() });

  res.json({ success: true, messages });
});

app.get('/api/admin/service/chats', requireAdmin, (req, res) => {
  const threads = [];
  for (const [userId, messages] of store.chats.entries()) {
    const lastMsg = messages[messages.length - 1] || null;
    threads.push({ userId, messageCount: messages.length, lastMessage: lastMsg });
  }
  res.json({ success: true, threads, data: threads });
});

app.post('/api/admin/service/chat/reply', requireAdmin, async (req, res) => {
  const { userId, uid, reply, message } = req.body || {};
  const targetId = String(userId || uid || '').trim();
  const replyText = String(reply || message || '').trim();

  if (!targetId || !replyText) {
    return res.status(400).json({ success: false, message: 'userId and reply are required' });
  }

  const messages = store.chats.get(targetId) || [];
  messages.push({
    sender: 'admin',
    text: replyText,
    createdAt: nowIso(),
  });
  store.chats.set(targetId, messages);
  await syncDoc('chats', targetId, { userId: targetId, messages, updatedAt: nowIso() });

  res.json({ success: true, message: 'Reply sent', messages });
});

// ============================================================================
// 12. LIVE CODE & USER HOST SITE INTEGRATION
// ============================================================================
app.post('/api/admin/user-site/connect', requireAdmin, async (req, res) => {
  const { url, forceReload } = req.body || {};
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl) {
    return res.status(400).json({ success: false, message: 'Site URL is required' });
  }

  store.liveCode.connectedSite = {
    url: cleanUrl,
    forceReload: Boolean(forceReload),
    updatedAt: nowIso(),
  };
  await syncDoc('live_code', 'site', store.liveCode.connectedSite);
  res.json({
    success: true,
    message: 'User host site connected',
    data: store.liveCode.connectedSite,
  });
});

app.post('/api/admin/user-code/publish', requireAdmin, async (req, res) => {
  const { html, css, js, note, forceReload } = req.body || {};
  store.liveCode.latestPublish = {
    html: html || '',
    css: css || '',
    js: js || '',
    note: note || '',
    forceReload: Boolean(forceReload),
    updatedAt: nowIso(),
  };
  await syncDoc('live_code', 'latest', store.liveCode.latestPublish);
  res.json({
    success: true,
    message: 'Live code published',
    data: store.liveCode.latestPublish,
  });
});

app.get('/api/user-code/latest', (req, res) => {
  res.json({
    success: true,
    data: store.liveCode,
  });
});

// ============================================================================
// 13. 404 & GLOBAL ERROR HANDLER
// ============================================================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]:', err);
  res.status(500).json({
    success: false,
    message: err?.message || 'Internal server error',
  });
});

// ============================================================================
// 14. SERVER STARTUP
// ============================================================================
hydrateFromFirestore().finally(() => {
  app.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT}`);
  });
});
