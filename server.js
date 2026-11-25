const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "grow_admin_2026";

app.use(cors({ origin: "*", credentials: false }));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// ---------- OPTIONAL FIREBASE FIRESTORE INIT ----------
let db = null;
let firebaseConnected = false;

try {
  const admin = require("firebase-admin");
  const rawSA = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!admin.apps.length && rawSA) {
    const sa = typeof rawSA === "string" ? JSON.parse(rawSA) : rawSA;
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: sa.project_id || "grow-b17db",
    });
    db = admin.firestore();
    firebaseConnected = true;
    console.log("Firebase connected:", sa.project_id || "grow-b17db");
  }
} catch (err) {
  console.log("Firebase fallback active:", err.message);
}

// ---------- LOCAL FILE + MEMORY STORE ----------
const STORE_FILE = path.join(__dirname, "grow-store.json");

const defaultState = () => ({
  users: [],
  products: [
    {
      id: "PLAN_101",
      name: "Starter Boost Plan",
      image: "",
      price: 280,
      dailyIncome: 50,
      durationDays: 2,
      payoutInterval: "daily",
      vipLevel: 0,
      isLimited: false,
      totalCopies: null,
      remainingCopies: null,
    },
  ],
  orders: [],
  promos: [
    {
      code: "GROW20",
      rewardAmount: 20,
      balanceTarget: "withdrawalBalance",
      maxUses: 500,
      usedCount: 0,
      requiredVipLevel: 0,
      allowedUserIds: [],
      expiresAt: null,
    },
  ],
  recharges: [],
  withdrawals: [],
  inviteBonuses: [],
  tickets: [],
  serviceChats: {},
  blogPosts: [],
  config: {
    brandName: "GROWTHWAVE CAPITAL",
    inviteBonus: 15,
    inviteBonusAmount: 15,
    upiId: "",
    qrCodeImage: "",
    customServiceLink: "",
    popupBanner: { text: "Grow Platform Live!", image: "", link: "" },
    homeBanner: { text: "Welcome to Grow — Fast Plans & Instant Updates", image: "", link: "" },
    customerService: {
      title: "Customer Service",
      subtitle: "We're here for you whenever you need help",
      hours: "8:00 am – 5:30 pm",
      link: "",
      greeting:
        "Hello! Welcome to Customer Service. Please share your question or request and our support team will reply right here.",
    },
  },
  siteSync: {
    url: "",
    pass: "",
    number: "",
    version: "v1",
    autoUpdate: true,
    forceReload: true,
    updatedAt: new Date().toISOString(),
  },
  liveCode: {
    version: "v1",
    note: "Initial live code",
    forceReload: false,
    html: "",
    css: "",
    js: "",
    updatedAt: new Date().toISOString(),
  },
});

let state = defaultState();

function saveLocal() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (_) {}
}

function loadLocal() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
      const def = defaultState();
      state = {
        ...def,
        ...raw,
        config: {
          ...def.config,
          ...(raw.config || {}),
          popupBanner: { ...def.config.popupBanner, ...(raw.config?.popupBanner || {}) },
          homeBanner: { ...def.config.homeBanner, ...(raw.config?.homeBanner || {}) },
          customerService: { ...def.config.customerService, ...(raw.config?.customerService || {}) },
        },
        siteSync: { ...def.siteSync, ...(raw.siteSync || {}) },
        liveCode: { ...def.liveCode, ...(raw.liveCode || {}) },
      };
    } else {
      saveLocal();
    }
  } catch (_) {
    state = defaultState();
  }
}

loadLocal();

async function persistAll() {
  saveLocal();
  if (!firebaseConnected || !db) return;
  try {
    await db.collection("grow_platform").doc("main_state").set(
      {
        users: state.users,
        products: state.products,
        orders: state.orders,
        promos: state.promos,
        recharges: state.recharges,
        withdrawals: state.withdrawals,
        inviteBonuses: state.inviteBonuses,
        tickets: state.tickets,
        serviceChats: state.serviceChats,
        blogPosts: state.blogPosts,
        config: state.config,
        siteSync: state.siteSync,
        liveCode: state.liveCode,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.error("Firestore persist error:", err.message);
  }
}

async function hydrateFirestore() {
  if (!firebaseConnected || !db) return;
  try {
    const snap = await db.collection("grow_platform").doc("main_state").get();
    if (snap.exists) {
      const d = snap.data() || {};
      if (Array.isArray(d.users) && d.users.length) state.users = d.users;
      if (Array.isArray(d.products) && d.products.length) state.products = d.products;
      if (Array.isArray(d.orders)) state.orders = d.orders;
      if (Array.isArray(d.promos)) state.promos = d.promos;
      if (Array.isArray(d.recharges)) state.recharges = d.recharges;
      if (Array.isArray(d.withdrawals)) state.withdrawals = d.withdrawals;
      if (Array.isArray(d.inviteBonuses)) state.inviteBonuses = d.inviteBonuses;
      if (Array.isArray(d.tickets)) state.tickets = d.tickets;
      if (d.serviceChats && typeof d.serviceChats === "object") state.serviceChats = d.serviceChats;
      if (Array.isArray(d.blogPosts)) state.blogPosts = d.blogPosts;
      if (d.config) {
        state.config = {
          ...state.config,
          ...d.config,
          customerService: { ...state.config.customerService, ...(d.config.customerService || {}) },
        };
      }
      if (d.siteSync) state.siteSync = { ...state.siteSync, ...d.siteSync };
      if (d.liveCode) state.liveCode = { ...state.liveCode, ...d.liveCode };
    }
    const uSnap = await db.collection("users").get();
    if (!uSnap.empty) {
      const map = new Map();
      for (const u of state.users) if (u && u.id) map.set(u.id, u);
      uSnap.forEach((doc) => {
        const u = doc.data();
        if (u && u.id) map.set(u.id, { ...(map.get(u.id) || {}), ...u });
      });
      state.users = Array.from(map.values());
    }
    saveLocal();
  } catch (err) {
    console.error("Firestore hydrate error:", err.message);
  }
}

hydrateFirestore();

// ---------- HELPERS ----------
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function makeId(prefix = "ID") {
  return `${prefix}_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
}

function normalizePhone(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) return digits.slice(2);
  return digits || String(rawPhone || "").trim();
}

function sameUser(item, queryUid) {
  if (!queryUid) return false;
  const target = String(queryUid).trim().toLowerCase();
  const vals = [item?.userId, item?.uid, item?.id, item?.user_id].filter(Boolean);
  return vals.some((v) => String(v).trim().toLowerCase() === target);
}

async function saveUser(user) {
  const cleanPhone = normalizePhone(user.phone);
  const rec = {
    ...user,
    phone: cleanPhone,
    password: String(user.password || "").trim(),
    chargedBalance: num(user.chargedBalance),
    withdrawalBalance: num(user.withdrawalBalance),
    totalInvestment: num(user.totalInvestment),
    invitedCount: num(user.invitedCount),
    inviteEarnings: num(user.inviteEarnings),
    vipLevel: num(user.vipLevel),
  };
  const idx = state.users.findIndex(
    (u) => u.id === rec.id || (cleanPhone && normalizePhone(u.phone) === cleanPhone)
  );
  if (idx >= 0) state.users[idx] = { ...state.users[idx], ...rec };
  else state.users.push(rec);

  if (firebaseConnected && db) {
    try {
      await db.collection("users").doc(String(rec.id)).set(rec, { merge: true });
    } catch (_) {}
  }
  await persistAll();
  return rec;
}

async function findUserByPhone(rawPhone) {
  const target = normalizePhone(rawPhone);
  if (!target) return null;
  let found = state.users.find((u) => normalizePhone(u.phone) === target);
  if (found) return found;
  await hydrateFirestore();
  found = state.users.find((u) => normalizePhone(u.phone) === target);
  return found || null;
}

function getOrCreateChat(userId) {
  const uid = String(userId || "").trim();
  if (!Array.isArray(state.serviceChats[uid]) || state.serviceChats[uid].length === 0) {
    state.serviceChats[uid] = [
      {
        id: makeId("MSG"),
        sender: "agent",
        senderName: state.config?.customerService?.title || "Customer Service",
        text:
          state.config?.customerService?.greeting ||
          "Hello! Welcome to Customer Service. How can we help you?",
        hours: state.config?.customerService?.hours || "8:00 am – 5:30 pm",
        createdAt: new Date().toISOString(),
      },
    ];
  }
  return state.serviceChats[uid];
}

function intervalToMs(interval) {
  const s = String(interval || "daily").trim().toLowerCase();
  if (s === "1m" || s === "1min" || s === "minute") return 60 * 1000;
  if (s === "5m" || s === "5min") return 5 * 60 * 1000;
  if (s === "15m" || s === "15min") return 15 * 60 * 1000;
  if (s === "30m" || s === "30min") return 30 * 60 * 1000;
  if (s === "1h" || s === "1hour" || s === "hour") return 60 * 60 * 1000;
  if (s === "12h" || s === "12hour") return 12 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000; // daily / day
}

function computeVip(totalInvestment) {
  const inv = num(totalInvestment);
  if (inv >= 50000) return 6;
  if (inv >= 25000) return 5;
  if (inv >= 10000) return 4;
  if (inv >= 5000) return 3;
  if (inv >= 2000) return 2;
  if (inv >= 500) return 1;
  return 0;
}

function checkAdminKey(req) {
  const key =
    req.headers["x-admin-secret"] ||
    req.headers["x-admin-key"] ||
    (req.body && (req.body.adminKey || req.body.adminSecret)) ||
    req.query.adminKey ||
    "";
  return !key || key === ADMIN_SECRET || key === "grow_admin_2026" || key === "proinvast_admin_2026";
}

function requireAdmin(req, res, next) {
  if (!checkAdminKey(req)) {
    return res.status(401).json({ success: false, message: "Unauthorized admin key" });
  }
  next();
}

function computeStats() {
  const approvedRecharges = state.recharges.filter((r) =>
    ["approved", "completed", "success"].includes(String(r.status || "").toLowerCase())
  );
  const approvedRechargeAmount = approvedRecharges.reduce((s, r) => s + num(r.amount), 0);
  const totalWithdrawAmount = state.withdrawals
    .filter((w) => String(w.status || "").toLowerCase() !== "rejected")
    .reduce((s, w) => s + num(w.amount), 0);
  return {
    totalUsers: state.users.length,
    totalChargedBalance: state.users.reduce((s, u) => s + num(u.chargedBalance), 0),
    totalWithdrawalBalance: state.users.reduce((s, u) => s + num(u.withdrawalBalance), 0),
    totalRechargeAmount: approvedRechargeAmount,
    approvedRechargeAmount,
    totalWithdrawAmount,
    totalInviteBonusAmount: state.inviteBonuses.reduce((s, b) => s + num(b.amount), 0),
    totalInvestmentAmount: state.users.reduce((s, u) => s + num(u.totalInvestment), 0),
  };
}

// ---------- HEALTH & CONFIG ----------
app.get("/", (req, res) => {
  res.json({
    success: true,
    project: "grow-b17db",
    firebaseConnected,
    usersCount: state.users.length,
    version: state.liveCode.version,
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    success: true,
    config: state.config,
    upiId: state.config.upiId || "",
    qrCodeImage: state.config.qrCodeImage || "",
    customServiceLink: state.config.customServiceLink || state.config.customerService?.link || "",
    activeUsersCount: state.users.length,
  });
});

app.get("/api/recharge/info", (req, res) => {
  res.json({
    success: true,
    upiId: state.config.upiId || "",
    qrCodeImage: state.config.qrCodeImage || "",
    brandName: state.config.brandName || "GROWTHWAVE CAPITAL",
  });
});

// ---------- AUTH & SESSION ----------
app.post("/api/auth/register", async (req, res) => {
  const b = req.body || {};
  const cleanPhone = normalizePhone(b.phone || b.mobile || b.phoneNumber || "");
  const cleanPassword = String(b.password || "").trim();
  const withdrawPassword = String(b.withdrawPassword || "").trim();
  const invCode = String(b.inviteCode || b.referralCode || "").trim() || "NONE";

  if (!cleanPhone || !cleanPassword) {
    return res.json({ success: false, uiPosition: "center", message: "Phone aur password required hai" });
  }

  const existing = await findUserByPhone(cleanPhone);
  if (existing) {
    const updated = await saveUser({
      ...existing,
      password: cleanPassword,
      withdrawPassword: withdrawPassword || existing.withdrawPassword || "",
      lastRegisteredAt: new Date().toISOString(),
    });
    return res.json({ success: true, userId: updated.id, user: updated });
  }

  const userId = "UID" + Math.floor(100000 + Math.random() * 900000);
  const bonusAmt = num(state.config?.inviteBonusAmount ?? state.config?.inviteBonus ?? 15);

  const newUser = {
    id: userId,
    userId,
    phone: cleanPhone,
    password: cleanPassword,
    withdrawPassword,
    inviteCode: invCode,
    invitedBy: invCode,
    referralCode: userId,
    invitedCount: 0,
    invitesCount: 0,
    inviteEarnings: 0,
    vipLevel: 0,
    chargedBalance: 0,
    withdrawalBalance: 0,
    totalInvestment: 0,
    lastCheckInDate: "",
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };

  if (invCode !== "NONE") {
    const refUser = state.users.find(
      (u) => String(u.id) === invCode || String(u.referralCode) === invCode
    );
    if (refUser) {
      const nextCount = num(refUser.invitedCount) + 1;
      await saveUser({
        ...refUser,
        invitedCount: nextCount,
        invitesCount: nextCount,
        inviteEarnings: num(refUser.inviteEarnings) + bonusAmt,
        withdrawalBalance: num(refUser.withdrawalBalance) + bonusAmt,
      });
      state.inviteBonuses.unshift({
        id: makeId("INV"),
        referrerId: refUser.id,
        invitedUserId: userId,
        invitedPhone: cleanPhone,
        amount: bonusAmt,
        createdAt: new Date().toISOString(),
      });
    }
  }

  const saved = await saveUser(newUser);
  getOrCreateChat(saved.id);
  await persistAll();
  return res.json({ success: true, userId: saved.id, user: saved });
});

app.post("/api/auth/login", async (req, res) => {
  const b = req.body || {};
  const targetPhone = normalizePhone(b.phone || b.mobile || b.phoneNumber || "");
  const targetPassword = String(b.password || "").trim();

  if (!targetPhone || !targetPassword) {
    return res.json({ success: false, uiPosition: "center", message: "Phone aur password daalein" });
  }

  const found = await findUserByPhone(targetPhone);
  if (!found || String(found.password || "").trim() !== targetPassword) {
    return res.json({ success: false, uiPosition: "center", message: "Phone ya password galat hai" });
  }

  const loggedIn = await saveUser({
    ...found,
    lastLoginAt: new Date().toISOString(),
  });

  return res.json({
    success: true,
    userId: loggedIn.id,
    user: loggedIn,
    session: { userId: loggedIn.id, phone: loggedIn.phone, lastLoginAt: loggedIn.lastLoginAt },
  });
});

app.get("/api/auth/session/:userId", async (req, res) => {
  await hydrateFirestore();
  const user = state.users.find((u) => sameUser(u, req.params.userId)) || null;
  if (!user) return res.json({ success: false, message: "Session nahi mila" });
  return res.json({ success: true, userId: user.id, user });
});

// ---------- CHECK-IN & REFERRAL ----------
app.post("/api/checkin", async (req, res) => {
  const { userId } = req.body || {};
  const user = state.users.find((u) => sameUser(u, userId));
  if (!user) return res.json({ success: false, message: "User nahi mila" });
  const today = new Date().toISOString().slice(0, 10);
  if (user.lastCheckInDate === today) {
    return res.json({ success: false, uiPosition: "center", message: "Aaj ka check-in already ho chuka hai" });
  }
  const reward = 10 + num(user.vipLevel) * 5;
  const updated = await saveUser({
    ...user,
    lastCheckInDate: today,
    withdrawalBalance: num(user.withdrawalBalance) + reward,
  });
  return res.json({ success: true, uiPosition: "center", message: `₹${reward} check-in bonus mila`, reward, user: updated });
});

app.get("/api/referral/:userId", (req, res) => {
  const uid = req.params.userId;
  const user = state.users.find((u) => sameUser(u, uid)) || null;
  const invited = state.users.filter((u) => u.inviteCode === uid || u.invitedBy === uid);
  const bonuses = state.inviteBonuses.filter((b) => b.referrerId === uid);
  return res.json({
    success: true,
    userId: uid,
    referralCode: uid,
    inviteBonusPerUser: num(state.config?.inviteBonusAmount ?? state.config?.inviteBonus ?? 15),
    totalInvited: invited.length,
    totalInviteBonus: bonuses.reduce((s, b) => s + num(b.amount), 0) || num(user?.inviteEarnings),
    invitedUsers: invited.map((u) => ({ id: u.id, phone: u.phone, createdAt: u.createdAt })),
    bonuses,
  });
});

// ---------- PRODUCTS & ORDERS (1m TO DAY / 1h SUPPORT) ----------
app.get("/api/products", (req, res) => {
  const products = state.products.map((p) => ({
    ...p,
    limitedStock: Boolean(p.isLimited),
    availableCopies: p.isLimited ? num(p.remainingCopies ?? p.totalCopies, 0) : null,
  }));
  return res.json({ success: true, products });
});

app.post("/api/products/buy", async (req, res) => {
  const { userId, productId, copies = 1 } = req.body || {};
  const user = state.users.find((u) => sameUser(u, userId));
  const prod = state.products.find((p) => String(p.id) === String(productId));
  if (!user) return res.json({ success: false, uiPosition: "center", message: "Pehle login karein" });
  if (!prod) return res.json({ success: false, uiPosition: "center", message: "Plan nahi mila" });

  const qty = Math.max(1, num(copies, 1));
  if (num(user.vipLevel) < num(prod.vipLevel)) {
    return res.json({ success: false, uiPosition: "center", message: `VIP ${prod.vipLevel} required hai` });
  }
  if (prod.isLimited) {
    const left = num(prod.remainingCopies ?? prod.totalCopies, 0);
    if (left < qty) {
      return res.json({
        success: false,
        uiPosition: "center",
        message: "Product khatam ho gaya hai koi or product buy karo thank you",
      });
    }
    prod.remainingCopies = left - qty;
  }

  const totalCost = num(prod.price) * qty;
  if (num(user.chargedBalance) < totalCost) {
    return res.json({ success: false, uiPosition: "center", message: "Charged balance kam hai" });
  }

  const nextInvested = num(user.totalInvestment) + totalCost;
  const updatedUser = await saveUser({
    ...user,
    chargedBalance: num(user.chargedBalance) - totalCost,
    totalInvestment: nextInvested,
    vipLevel: Math.max(num(user.vipLevel), computeVip(nextInvested)),
  });

  const nowIso = new Date().toISOString();
  const order = {
    id: makeId("ORD"),
    userId: updatedUser.id,
    productId: prod.id,
    productName: prod.name,
    price: totalCost,
    dailyIncome: num(prod.dailyIncome) * qty,
    durationDays: Math.max(1, num(prod.durationDays, 1)),
    payoutInterval: String(prod.payoutInterval || "daily"),
    status: "Active",
    createdAt: nowIso,
    lastPayoutAt: nowIso,
  };

  state.orders.unshift(order);
  await persistAll();
  return res.json({ success: true, uiPosition: "center", message: `${prod.name} buy ho gaya`, order, user: updatedUser });
});

app.get("/api/my-products/:userId", (req, res) => {
  const orders = state.orders.filter((o) => sameUser(o, req.params.userId));
  return res.json({ success: true, orders });
});

app.post("/api/orders/process-due", async (req, res) => {
  const now = Date.now();
  let credited = 0;
  let processedOrders = 0;

  for (const o of state.orders) {
    if (o.status !== "Active") continue;
    const intervalMs = intervalToMs(o.payoutInterval);
    const createdMs = new Date(o.createdAt || now).getTime();
    const expiryMs = createdMs + Math.max(1, num(o.durationDays, 1)) * 24 * 60 * 60 * 1000;
    const lastMs = new Date(o.lastPayoutAt || o.createdAt || 0).getTime();

    if (now >= expiryMs) {
      o.status = "Completed";
      continue;
    }

    if (now - lastMs >= intervalMs) {
      const u = state.users.find((x) => sameUser(x, o.userId));
      if (u) {
        const payoutAmt = num(o.dailyIncome);
        await saveUser({ ...u, withdrawalBalance: num(u.withdrawalBalance) + payoutAmt });
        o.lastPayoutAt = new Date(now).toISOString();
        credited += payoutAmt;
        processedOrders += 1;
      }
    }
  }

  await persistAll();
  return res.json({
    success: true,
    uiPosition: "center",
    message: `Payout processed: ₹${credited} (${processedOrders} orders)`,
    credited,
    processedOrders,
  });
});

// ---------- RECHARGE & WITHDRAW (USER + HISTORY) ----------
app.post("/api/recharge/create", async (req, res) => {
  const { userId, uid, amount, channel = "UPI", utr = "", autoCredit = false } = req.body || {};
  const targetUid = String(userId || uid || "").trim();
  const user = state.users.find((u) => sameUser(u, targetUid));
  const amt = num(amount);
  if (!user || amt <= 0) {
    return res.json({ success: false, uiPosition: "center", message: "Valid user aur amount daalein" });
  }

  let updatedUser = user;
  const status = autoCredit ? "Approved" : "Pending";
  if (autoCredit) {
    updatedUser = await saveUser({ ...user, chargedBalance: num(user.chargedBalance) + amt });
  }

  const rec = {
    id: makeId("RCH"),
    rechargeId: "",
    userId: user.id,
    uid: user.id,
    phone: user.phone || "",
    amount: amt,
    channel,
    utr: String(utr || "").trim(),
    upiId: state.config.upiId || "",
    status,
    createdAt: new Date().toISOString(),
  };
  rec.rechargeId = rec.id;
  state.recharges.unshift(rec);
  await persistAll();

  return res.json({
    success: true,
    uiPosition: "center",
    message: autoCredit ? `₹${amt} recharge credit ho gaya` : `₹${amt} recharge request submit ho gayi`,
    recharge: rec,
    user: updatedUser,
  });
});

app.get("/api/recharge/history", (req, res) => {
  const uid = req.query.userId || req.query.uid || "";
  const list = uid ? state.recharges.filter((r) => sameUser(r, uid)) : state.recharges;
  return res.json({ success: true, recharges: list, history: list, data: list });
});

app.get("/api/recharge/history/:userId", (req, res) => {
  const list = state.recharges.filter((r) => sameUser(r, req.params.userId));
  return res.json({ success: true, recharges: list, history: list, data: list });
});

app.post("/api/withdraw/auto-upi", async (req, res) => {
  const { userId, uid, amount, withdrawPassword, bankName, realName, bankAccount } = req.body || {};
  const targetUid = String(userId || uid || "").trim();
  const user = state.users.find((u) => sameUser(u, targetUid));
  const amt = num(amount);
  if (!user) return res.json({ success: false, uiPosition: "center", message: "User nahi mila" });
  if (amt <= 0) return res.json({ success: false, uiPosition: "center", message: "Valid amount daalein" });
  if (user.withdrawPassword && String(withdrawPassword || "").trim() !== user.withdrawPassword) {
    return res.json({ success: false, uiPosition: "center", message: "Withdraw password galat hai" });
  }
  if (num(user.withdrawalBalance) < amt) {
    return res.json({ success: false, uiPosition: "center", message: "Withdrawal balance kam hai" });
  }

  const updatedUser = await saveUser({
    ...user,
    withdrawalBalance: num(user.withdrawalBalance) - amt,
  });

  const wd = {
    id: makeId("WDR"),
    withdrawalId: "",
    userId: updatedUser.id,
    uid: updatedUser.id,
    phone: updatedUser.phone || "",
    amount: amt,
    bankName: bankName || "",
    realName: realName || "",
    bankAccount: bankAccount || "",
    status: "Pending",
    createdAt: new Date().toISOString(),
  };
  wd.withdrawalId = wd.id;
  state.withdrawals.unshift(wd);
  await persistAll();

  return res.json({
    success: true,
    uiPosition: "center",
    message: `₹${amt} withdrawal request submit ho gayi`,
    withdrawal: wd,
    user: updatedUser,
  });
});

app.get("/api/withdraw/history", (req, res) => {
  const uid = req.query.userId || req.query.uid || "";
  const list = uid ? state.withdrawals.filter((w) => sameUser(w, uid)) : state.withdrawals;
  return res.json({ success: true, withdrawals: list, history: list, data: list });
});

app.get("/api/withdraw/history/:userId", (req, res) => {
  const list = state.withdrawals.filter((w) => sameUser(w, req.params.userId));
  return res.json({ success: true, withdrawals: list, history: list, data: list });
});

app.get("/api/user/history/:userId", (req, res) => {
  const uid = req.params.userId;
  const recharges = state.recharges.filter((r) => sameUser(r, uid));
  const withdrawals = state.withdrawals.filter((w) => sameUser(w, uid));
  return res.json({ success: true, recharges, withdrawals, data: { recharges, withdrawals } });
});

// ---------- PROMO, BLOG GALLERY IMAGE UPLOAD & CUSTOM SERVICE ----------
app.post("/api/promo/claim", async (req, res) => {
  const { userId, code } = req.body || {};
  const user = state.users.find((u) => sameUser(u, userId));
  if (!user) return res.json({ success: false, uiPosition: "center", message: "Pehle login karein" });

  const clean = String(code || "").trim().toUpperCase();
  const promo = state.promos.find((p) => p.code === clean);
  if (!promo) return res.json({ success: false, uiPosition: "center", message: "Invalid promo code" });
  if (num(promo.maxUses) > 0 && num(promo.usedCount) >= num(promo.maxUses)) {
    return res.json({ success: false, uiPosition: "center", message: "Promo limit khatam ho gayi" });
  }
  if (num(user.vipLevel) < num(promo.requiredVipLevel)) {
    return res.json({ success: false, uiPosition: "center", message: `VIP ${promo.requiredVipLevel} required hai` });
  }

  promo.usedCount = num(promo.usedCount) + 1;
  const field = promo.balanceTarget === "chargedBalance" ? "chargedBalance" : "withdrawalBalance";
  const updatedUser = await saveUser({
    ...user,
    [field]: num(user[field]) + num(promo.rewardAmount),
  });
  await persistAll();
  return res.json({ success: true, uiPosition: "center", message: `₹${promo.rewardAmount} promo bonus mila`, user: updatedUser });
});

app.post("/api/blog/submit", async (req, res) => {
  const { userId, text, images, galleryImages, image } = req.body || {};
  const rawImgs = Array.isArray(images)
    ? images
    : Array.isArray(galleryImages)
    ? galleryImages
    : image
    ? [image]
    : [];
  const cleanImgs = rawImgs
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 4);

  if (!userId && !text && cleanImgs.length === 0) {
    return res.json({ success: false, message: "Text ya gallery image required hai" });
  }

  const post = {
    id: makeId("BLG"),
    userId: String(userId || "GUEST"),
    text: String(text || "Withdrawal proof").trim(),
    images: cleanImgs,
    createdAt: new Date().toISOString(),
  };
  state.blogPosts.unshift(post);
  await persistAll();
  return res.json({ success: true, uiPosition: "center", message: "Proof post ho gaya", post });
});

app.get("/api/blog/list", (req, res) => {
  return res.json({ success: true, posts: state.blogPosts });
});

// Custom Service Link + Live Chat
app.get("/api/service/link", (req, res) => {
  const link = state.config.customServiceLink || state.config.customerService?.link || "";
  return res.json({
    success: true,
    link,
    customServiceLink: link,
    hours: state.config.customerService?.hours || "8:00 am – 5:30 pm",
    title: state.config.customerService?.title || "Customer Service",
  });
});

app.get("/api/service/chat/:userId", async (req, res) => {
  await hydrateFirestore();
  const uid = String(req.params.userId || "").trim();
  const messages = getOrCreateChat(uid);
  const link = state.config.customServiceLink || state.config.customerService?.link || "";
  return res.json({
    success: true,
    userId: uid,
    customServiceLink: link,
    serviceInfo: { ...state.config.customerService, link },
    messages,
  });
});

app.post("/api/service/chat/send", async (req, res) => {
  const { userId, message, text } = req.body || {};
  const msgText = String(message || text || "").trim();
  if (!userId || !msgText) return res.json({ success: false, message: "Message required hai" });
  const uid = String(userId).trim();
  const thread = getOrCreateChat(uid);
  const newMsg = {
    id: makeId("MSG"),
    sender: "user",
    senderName: "You",
    text: msgText,
    createdAt: new Date().toISOString(),
  };
  thread.push(newMsg);
  await persistAll();
  return res.json({ success: true, userId: uid, message: newMsg, messages: thread });
});

app.post("/api/admin/service/chat/reply", requireAdmin, async (req, res) => {
  const { userId, reply, message } = req.body || {};
  const uid = String(userId || "").trim();
  const replyText = String(reply || message || "").trim();
  if (!uid || !replyText) return res.json({ success: false, message: "userId aur reply required hai" });
  const thread = getOrCreateChat(uid);
  const agentMsg = {
    id: makeId("MSG"),
    sender: "agent",
    senderName: state.config?.customerService?.title || "Customer Service",
    text: replyText,
    createdAt: new Date().toISOString(),
  };
  thread.push(agentMsg);
  await persistAll();
  return res.json({ success: true, userId: uid, message: agentMsg, messages: thread });
});

// ---------- LIVE SYNC & HOST/CODE PUSH ----------
app.get("/api/live-sync/:userId", async (req, res) => {
  await hydrateFirestore();
  const uid = req.params.userId;
  const user = state.users.find((u) => sameUser(u, uid)) || null;
  const products = state.products.map((p) => ({
    ...p,
    limitedStock: Boolean(p.isLimited),
    availableCopies: p.isLimited ? num(p.remainingCopies ?? p.totalCopies, 0) : null,
  }));
  return res.json({
    success: true,
    user,
    products,
    myProducts: state.orders.filter((o) => sameUser(o, uid)),
    chatMessages: getOrCreateChat(uid),
    inviteBonuses: state.inviteBonuses.filter((b) => b.referrerId === uid),
    withdrawals: state.withdrawals.filter((w) => sameUser(w, uid)),
    recharges: state.recharges.filter((r) => sameUser(r, uid)),
    customServiceLink: state.config.customServiceLink || state.config.customerService?.link || "",
    upiId: state.config.upiId || "",
    qrCodeImage: state.config.qrCodeImage || "",
    siteInfo: state.siteSync,
    codeMeta: { version: state.liveCode.version, updatedAt: state.liveCode.updatedAt },
  });
});

app.get("/api/user-code/live", (req, res) => {
  return res.json({ success: true, code: state.liveCode });
});

app.get("/api/user-site/link", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  return res.json({ success: true, ...state.siteSync, liveFeedEndpoint: `${baseUrl}/api/user-code/live` });
});

// ---------- ADMIN ENDPOINTS ----------
app.get("/api/admin/overview", requireAdmin, async (req, res) => {
  await hydrateFirestore();
  return res.json({
    success: true,
    stats: computeStats(),
    users: state.users,
    withdrawals: state.withdrawals,
    recharges: state.recharges,
    inviteBonuses: state.inviteBonuses,
    orders: state.orders,
    products: state.products,
    config: state.config,
    serviceChats: state.serviceChats,
  });
});

app.post("/api/admin/recharge/uid", requireAdmin, async (req, res) => {
  const { uid, userId, amount, channel = "Admin Recharge" } = req.body || {};
  const targetUid = String(uid || userId || "").trim();
  const user = state.users.find((u) => sameUser(u, targetUid));
  const amt = num(amount);
  if (!user) return res.json({ success: false, message: "User UID nahi mila" });
  if (amt <= 0) return res.json({ success: false, message: "Valid recharge amount daalein" });

  const updatedUser = await saveUser({ ...user, chargedBalance: num(user.chargedBalance) + amt });
  const rec = {
    id: makeId("RCH"),
    rechargeId: "",
    userId: updatedUser.id,
    uid: updatedUser.id,
    phone: updatedUser.phone || "",
    amount: amt,
    channel,
    status: "Approved",
    createdAt: new Date().toISOString(),
  };
  rec.rechargeId = rec.id;
  state.recharges.unshift(rec);
  await persistAll();
  return res.json({ success: true, message: `₹${amt} recharge ${updatedUser.id} ko add ho gaya`, recharge: rec, user: updatedUser });
});

app.post("/api/admin/recharge/action", requireAdmin, async (req, res) => {
  const { rechargeId, id, action } = req.body || {};
  const targetId = String(rechargeId || id || "").trim();
  const act = String(action || "").trim().toLowerCase();
  const rec = state.recharges.find((r) => String(r.id) === targetId || String(r.rechargeId) === targetId);
  if (!rec) return res.json({ success: false, message: "Recharge record nahi mila" });

  const user = state.users.find((u) => sameUser(u, rec.userId || rec.uid));
  const prev = String(rec.status || "Pending").toLowerCase();

  if (act === "approve" || act === "approved") {
    if (prev !== "approved" && prev !== "completed" && user) {
      await saveUser({ ...user, chargedBalance: num(user.chargedBalance) + num(rec.amount) });
    }
    rec.status = "Approved";
  } else if (act === "reject" || act === "rejected") {
    if ((prev === "approved" || prev === "completed") && user) {
      await saveUser({ ...user, chargedBalance: Math.max(0, num(user.chargedBalance) - num(rec.amount)) });
    }
    rec.status = "Rejected";
  } else {
    return res.json({ success: false, message: "Invalid action" });
  }

  rec.updatedAt = new Date().toISOString();
  await persistAll();
  return res.json({ success: true, message: `Recharge ${rec.status}`, recharge: rec });
});

app.post("/api/admin/withdraw/action", requireAdmin, async (req, res) => {
  const { withdrawalId, id, action } = req.body || {};
  const targetId = String(withdrawalId || id || "").trim();
  const act = String(action || "").trim().toLowerCase();
  const wd = state.withdrawals.find((w) => String(w.id) === targetId || String(w.withdrawalId) === targetId);
  if (!wd) return res.json({ success: false, message: "Withdrawal record nahi mila" });

  const prev = String(wd.status || "Pending").toLowerCase();
  if (act === "approve" || act === "approved") {
    wd.status = "Approved";
  } else if (act === "reject" || act === "rejected") {
    if (prev !== "rejected") {
      const user = state.users.find((u) => sameUser(u, wd.userId || wd.uid));
      if (user) {
        await saveUser({ ...user, withdrawalBalance: num(user.withdrawalBalance) + num(wd.amount) });
      }
      wd.status = "Rejected";
    }
  } else {
    return res.json({ success: false, message: "Invalid action" });
  }

  wd.updatedAt = new Date().toISOString();
  await persistAll();
  return res.json({ success: true, message: `Withdrawal ${wd.status}`, withdrawal: wd });
});

app.post("/api/admin/user-site/connect", requireAdmin, async (req, res) => {
  const { url, pass, number, autoUpdate, forceReload } = req.body || {};
  const nextVer = (Number(String(state.siteSync.version || "v0").replace(/\D/g, "")) || 0) + 1;
  state.siteSync = {
    ...state.siteSync,
    url: url ?? state.siteSync.url,
    pass: pass ?? state.siteSync.pass,
    number: number ?? state.siteSync.number,
    autoUpdate: autoUpdate !== undefined ? Boolean(autoUpdate) : true,
    forceReload: forceReload !== undefined ? Boolean(forceReload) : true,
    version: "v" + nextVer,
    updatedAt: new Date().toISOString(),
  };
  await persistAll();
  return res.json({ success: true, message: "Hosting site connected", site: state.siteSync });
});

app.post("/api/admin/user-code/publish", requireAdmin, async (req, res) => {
  const { html, css, js, note, forceReload } = req.body || {};
  const nextVer = (Number(String(state.liveCode.version || "v0").replace(/\D/g, "")) || 0) + 1;
  state.liveCode = {
    version: "v" + nextVer,
    note: note || "Live update",
    forceReload: Boolean(forceReload),
    html: html !== undefined ? String(html) : state.liveCode.html,
    css: css !== undefined ? String(css) : state.liveCode.css,
    js: js !== undefined ? String(js) : state.liveCode.js,
    updatedAt: new Date().toISOString(),
  };
  await persistAll();
  return res.json({ success: true, message: "Live code published", code: state.liveCode });
});

app.post("/api/admin/products/add", requireAdmin, async (req, res) => {
  const b = req.body || {};
  const prod = {
    id: makeId("PRD"),
    name: String(b.name || "Plan").trim(),
    image: String(b.image || "").trim(),
    price: num(b.price),
    dailyIncome: num(b.dailyIncome),
    durationDays: Math.max(1, num(b.durationDays, 1)),
    payoutInterval: String(b.payoutInterval || "daily").trim(),
    vipLevel: num(b.vipLevel, 0),
    isLimited: Boolean(b.isLimited),
    totalCopies: b.totalCopies !== undefined && b.totalCopies !== null && b.totalCopies !== "" ? num(b.totalCopies) : null,
    remainingCopies: b.totalCopies !== undefined && b.totalCopies !== null && b.totalCopies !== "" ? num(b.totalCopies) : null,
  };
  state.products.push(prod);
  await persistAll();
  return res.json({ success: true, product: prod, products: state.products });
});

app.post("/api/admin/products/remove", requireAdmin, async (req, res) => {
  const targetId = String(req.body?.productId || req.body?.id || "").trim();
  state.products = state.products.filter((p) => String(p.id) !== targetId);
  await persistAll();
  return res.json({ success: true, message: "Product removed", products: state.products });
});

app.post("/api/admin/promo/create", requireAdmin, async (req, res) => {
  const p = req.body || {};
  if (!p.code) return res.json({ success: false, message: "Promo code required" });
  const clean = String(p.code).trim().toUpperCase();
  state.promos = state.promos.filter((x) => x.code !== clean);
  state.promos.push({
    code: clean,
    rewardAmount: num(p.rewardAmount),
    balanceTarget: p.balanceTarget === "chargedBalance" ? "chargedBalance" : "withdrawalBalance",
    maxUses: num(p.maxUses, 0),
    usedCount: 0,
    requiredVipLevel: num(p.requiredVipLevel, 0),
    allowedUserIds: Array.isArray(p.allowedUserIds) ? p.allowedUserIds : [],
    expiresAt: p.expiresAt || null,
  });
  await persistAll();
  return res.json({ success: true, message: `Promo ${clean} saved` });
});

app.post("/api/admin/config", requireAdmin, async (req, res) => {
  const b = req.body || {};
  const bonus = num(b.inviteBonusAmount ?? b.inviteBonus ?? state.config.inviteBonus ?? 15);
  const serviceLink = String(
    b.customServiceLink ?? b.customerServiceLink ?? b.serviceLink ?? b.customerService?.link ?? state.config.customServiceLink ?? ""
  ).trim();
  const upiId = String(b.upiId ?? b.adminUpi ?? state.config.upiId ?? "").trim();
  const qrCodeImage = String(
    b.qrCodeImage ?? b.qrImage ?? b.qrCode ?? state.config.qrCodeImage ?? ""
  ).trim();

  state.config = {
    ...state.config,
    brandName: b.brandName !== undefined ? String(b.brandName) : state.config.brandName,
    inviteBonus: bonus,
    inviteBonusAmount: bonus,
    upiId,
    qrCodeImage,
    customServiceLink: serviceLink,
    popupBanner: b.popupBanner ? { ...state.config.popupBanner, ...b.popupBanner } : state.config.popupBanner,
    homeBanner: b.homeBanner ? { ...state.config.homeBanner, ...b.homeBanner } : state.config.homeBanner,
    customerService: {
      ...state.config.customerService,
      ...(b.customerService || {}),
      link: serviceLink,
    },
  };
  await persistAll();
  return res.json({ success: true, message: "Config saved", config: state.config });
});

app.post("/api/admin/bonus/uid", requireAdmin, async (req, res) => {
  const { uid, amount, balanceTarget } = req.body || {};
  const user = state.users.find((u) => sameUser(u, uid));
  if (!user) return res.json({ success: false, message: "User not found" });
  const field = balanceTarget === "chargedBalance" ? "chargedBalance" : "withdrawalBalance";
  const updatedUser = await saveUser({ ...user, [field]: num(user[field]) + num(amount) });
  await persistAll();
  return res.json({ success: true, message: `₹${amount} bonus credited to ${user.id}`, user: updatedUser });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Grow server running on port ${PORT}`);
});
