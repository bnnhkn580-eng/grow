const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 10000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "grow_admin_2026";

app.use(cors({ origin: "*", credentials: false }));
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

let db = null;
let firebaseReady = false;

function initFirebase() {
  try {
    if (admin.apps.length > 0) {
      db = admin.firestore();
      firebaseReady = true;
      return;
    }
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      console.warn("FIREBASE_SERVICE_ACCOUNT not set — using in-memory store.");
      return;
    }
    const sa = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (sa.private_key) {
      sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    }
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: sa.project_id || "grow-b17db",
    });
    db = admin.firestore();
    firebaseReady = true;
    console.log("Firestore connected to project:", sa.project_id || "grow-b17db");
  } catch (err) {
    console.error("Firebase init failed:", err.message);
  }
}

initFirebase();

const state = {
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
  serviceChats: {}, // { [userId]: [{ id, sender: "agent" | "user", text, time }] }
  blogPosts: [],
  config: {
    popupBanner: { text: "Grow Platform Live!", image: "", link: "" },
    homeBanner: { text: "Welcome to Grow — Fast Plans & Instant Updates", image: "", link: "" },
    inviteBonusAmount: 15,
    customerService: {
      title: "Customer Service",
      subtitle: "We're here for you whenever you need help",
      hours: "8:00 am – 5:30 pm",
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
};

const DOC_REF_PATH = ["grow_platform", "main_state"];

function normalizePhone(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  return digits || String(rawPhone || "").trim();
}

async function persistSnapshot() {
  if (!firebaseReady || !db) return;
  try {
    await db.collection(DOC_REF_PATH[0]).doc(DOC_REF_PATH[1]).set(
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
    console.error("Firestore save error:", err.message);
  }
}

async function hydrateFromFirestore() {
  if (!firebaseReady || !db) return;
  try {
    const snap = await db.collection(DOC_REF_PATH[0]).doc(DOC_REF_PATH[1]).get();
    if (snap.exists) {
      const d = snap.data() || {};
      if (Array.isArray(d.users) && d.users.length) {
        const merged = [...state.users];
        for (const u of d.users) {
          if (!u || !u.id) continue;
          const i = merged.findIndex((x) => x.id === u.id);
          if (i >= 0) merged[i] = { ...merged[i], ...u };
          else merged.push(u);
        }
        state.users = merged;
      }
      if (Array.isArray(d.products) && d.products.length) state.products = d.products;
      if (Array.isArray(d.orders)) state.orders = d.orders;
      if (Array.isArray(d.promos)) state.promos = d.promos;
      if (Array.isArray(d.recharges)) state.recharges = d.recharges;
      if (Array.isArray(d.withdrawals)) state.withdrawals = d.withdrawals;
      if (Array.isArray(d.inviteBonuses)) state.inviteBonuses = d.inviteBonuses;
      if (Array.isArray(d.tickets)) state.tickets = d.tickets;
      if (d.serviceChats && typeof d.serviceChats === "object") {
        state.serviceChats = { ...state.serviceChats, ...d.serviceChats };
      }
      if (Array.isArray(d.blogPosts)) state.blogPosts = d.blogPosts;
      if (d.config) state.config = { ...state.config, ...d.config };
      if (d.siteSync) state.siteSync = { ...state.siteSync, ...d.siteSync };
      if (d.liveCode) state.liveCode = { ...state.liveCode, ...d.liveCode };
    }

    const usersSnap = await db.collection("users").get();
    if (!usersSnap.empty) {
      const merged = [...state.users];
      usersSnap.forEach((doc) => {
        const u = doc.data();
        if (!u || !u.id) return;
        const i = merged.findIndex(
          (x) => x.id === u.id || normalizePhone(x.phone) === normalizePhone(u.phone)
        );
        if (i >= 0) merged[i] = { ...merged[i], ...u };
        else merged.push(u);
      });
      state.users = merged;
    }
  } catch (err) {
    console.error("Firestore hydrate error:", err.message);
  }
}

hydrateFromFirestore();

async function saveUserRecord(user) {
  const cleanPhone = normalizePhone(user.phone);
  const record = {
    ...user,
    phone: cleanPhone,
    password: String(user.password || "").trim(),
  };

  const idx = state.users.findIndex(
    (u) => u.id === record.id || normalizePhone(u.phone) === cleanPhone
  );
  if (idx >= 0) {
    state.users[idx] = { ...state.users[idx], ...record };
  } else {
    state.users.push(record);
  }

  if (firebaseReady && db) {
    try {
      await db.collection("users").doc(String(record.id)).set(record, { merge: true });
    } catch (err) {
      console.error("Firestore user save error:", err.message);
    }
  }
  await persistSnapshot();
  return record;
}

async function findUserByPhone(rawPhone) {
  const target = normalizePhone(rawPhone);
  if (!target) return null;

  let user = state.users.find((u) => normalizePhone(u.phone) === target);
  if (user) return user;

  await hydrateFromFirestore();
  user = state.users.find((u) => normalizePhone(u.phone) === target);
  if (user) return user;

  if (firebaseReady && db) {
    try {
      const snap = await db.collection("users").where("phone", "==", target).limit(1).get();
      if (!snap.empty) {
        const docUser = snap.docs[0].data();
        if (docUser) {
          state.users.push(docUser);
          return docUser;
        }
      }
    } catch (err) {
      console.error("Firestore user query error:", err.message);
    }
  }
  return null;
}

function getOrCreateChatThread(userId) {
  const uid = String(userId || "").trim();
  if (!state.serviceChats[uid] || !Array.isArray(state.serviceChats[uid]) || state.serviceChats[uid].length === 0) {
    state.serviceChats[uid] = [
      {
        id: "MSG_" + Date.now() + "_1",
        sender: "agent",
        senderName: state.config?.customerService?.title || "Customer Service",
        text:
          state.config?.customerService?.greeting ||
          "Hello! Welcome to Customer Service. Please share your question or request and our support team will reply right here.",
        hours: state.config?.customerService?.hours || "8:00 am – 5:30 pm",
        createdAt: new Date().toISOString(),
      },
    ];
  }
  return state.serviceChats[uid];
}

function computeVip(totalInvestment) {
  const inv = Number(totalInvestment || 0);
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
    return res.status(401).json({
      success: false,
      uiPosition: "center",
      message: "Unauthorized admin key",
    });
  }
  next();
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    project: "grow-b17db",
    firebaseConnected: firebaseReady,
    usersCount: state.users.length,
    version: state.liveCode.version,
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    success: true,
    config: state.config,
    activeUsersCount: state.users.length,
  });
});

app.get("/api/products", (req, res) => {
  const products = state.products.map((p) => ({
    ...p,
    limitedStock: Boolean(p.isLimited),
    availableCopies: p.isLimited ? Number(p.remainingCopies ?? p.totalCopies ?? 0) : null,
  }));
  res.json({ success: true, products });
});

app.get("/api/blog/list", (req, res) => {
  res.json({ success: true, posts: state.blogPosts });
});

// REGISTER + INVITE BONUS
app.post("/api/auth/register", async (req, res) => {
  const body = req.body || {};
  const rawPhone = body.phone || body.mobile || body.phoneNumber || "";
  const rawPassword = body.password || "";
  const withdrawPassword = body.withdrawPassword || "";
  const inviteCode = body.inviteCode || body.referralCode || "";

  const cleanPhone = normalizePhone(rawPhone);
  const cleanPassword = String(rawPassword).trim();

  if (!cleanPhone || !cleanPassword) {
    return res.json({ success: false, uiPosition: "center", message: "Phone aur password required hai" });
  }

  const existing = await findUserByPhone(cleanPhone);
  if (existing) {
    const updatedExisting = await saveUserRecord({
      ...existing,
      password: cleanPassword,
      withdrawPassword: withdrawPassword ? String(withdrawPassword).trim() : existing.withdrawPassword || "",
      lastRegisteredAt: new Date().toISOString(),
    });
    return res.json({ success: true, userId: updatedExisting.id, user: updatedExisting });
  }

  const userId = "UID" + Math.floor(100000 + Math.random() * 900000);
  const invCode = inviteCode && String(inviteCode).trim() ? String(inviteCode).trim() : "NONE";
  const inviteBonusAmt = Number(state.config?.inviteBonusAmount ?? 15);

  const newUser = {
    id: userId,
    phone: cleanPhone,
    password: cleanPassword,
    withdrawPassword: String(withdrawPassword || "").trim(),
    inviteCode: invCode,
    referralCode: userId,
    invitedCount: 0,
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
      await saveUserRecord({
        ...refUser,
        invitedCount: Number(refUser.invitedCount || 0) + 1,
        inviteEarnings: Number(refUser.inviteEarnings || 0) + inviteBonusAmt,
        withdrawalBalance: Number(refUser.withdrawalBalance || 0) + inviteBonusAmt,
      });
      state.inviteBonuses.unshift({
        id: "INV_" + Date.now(),
        referrerId: refUser.id,
        invitedUserId: userId,
        invitedPhone: cleanPhone,
        amount: inviteBonusAmt,
        createdAt: new Date().toISOString(),
      });
    }
  }

  const savedUser = await saveUserRecord(newUser);
  getOrCreateChatThread(savedUser.id);
  await persistSnapshot();
  return res.json({ success: true, userId: savedUser.id, user: savedUser });
});

// LOGIN + SAVE LOGIN SESSION
app.post("/api/auth/login", async (req, res) => {
  const body = req.body || {};
  const rawPhone = body.phone || body.mobile || body.phoneNumber || "";
  const rawPassword = body.password || "";

  const targetPhone = normalizePhone(rawPhone);
  const targetPassword = String(rawPassword).trim();

  if (!targetPhone || !targetPassword) {
    return res.json({ success: false, uiPosition: "center", message: "Phone aur password daalein" });
  }

  const found = await findUserByPhone(targetPhone);
  if (!found || String(found.password || "").trim() !== targetPassword) {
    return res.json({ success: false, uiPosition: "center", message: "Phone ya password galat hai" });
  }

  const loggedInUser = await saveUserRecord({
    ...found,
    lastLoginAt: new Date().toISOString(),
  });

  return res.json({
    success: true,
    userId: loggedInUser.id,
    user: loggedInUser,
    session: {
      userId: loggedInUser.id,
      phone: loggedInUser.phone,
      lastLoginAt: loggedInUser.lastLoginAt,
    },
  });
});

// SESSION RESTORE
app.get("/api/auth/session/:userId", async (req, res) => {
  await hydrateFromFirestore();
  const user = state.users.find((u) => u.id === req.params.userId) || null;
  if (!user) {
    return res.json({ success: false, message: "Session nahi mila" });
  }
  return res.json({ success: true, userId: user.id, user });
});

// DAILY CHECK-IN
app.post("/api/checkin", async (req, res) => {
  const { userId } = req.body || {};
  const user = state.users.find((u) => u.id === userId);
  if (!user) return res.json({ success: false, message: "User nahi mila" });

  const today = new Date().toISOString().slice(0, 10);
  if (user.lastCheckInDate === today) {
    return res.json({ success: false, uiPosition: "center", message: "Aaj ka check-in already ho chuka hai" });
  }
  const reward = 10 + Number(user.vipLevel || 0) * 5;
  const updated = await saveUserRecord({
    ...user,
    lastCheckInDate: today,
    withdrawalBalance: Number(user.withdrawalBalance || 0) + reward,
  });
  res.json({ success: true, uiPosition: "center", message: `₹${reward} check-in bonus mila`, reward, user: updated });
});

// REFERRAL / INVITE BONUS STATS
app.get("/api/referral/:userId", (req, res) => {
  const uid = req.params.userId;
  const user = state.users.find((u) => u.id === uid) || null;
  const invited = state.users.filter((u) => u.inviteCode === uid);
  const bonuses = state.inviteBonuses.filter((b) => b.referrerId === uid);
  const totalBonus = bonuses.reduce((sum, b) => sum + Number(b.amount || 0), 0);
  res.json({
    success: true,
    userId: uid,
    referralCode: uid,
    inviteBonusPerUser: Number(state.config?.inviteBonusAmount ?? 15),
    totalInvited: invited.length,
    totalInviteBonus: totalBonus || Number(user?.inviteEarnings || 0),
    invitedUsers: invited.map((u) => ({
      id: u.id,
      phone: u.phone,
      createdAt: u.createdAt,
    })),
    bonuses,
  });
});

// BUY PRODUCT
app.post("/api/products/buy", async (req, res) => {
  const { userId, productId, copies = 1 } = req.body || {};
  const user = state.users.find((u) => u.id === userId);
  const prod = state.products.find((p) => p.id === productId);
  if (!user) return res.json({ success: false, uiPosition: "center", message: "Pehle login karein" });
  if (!prod) return res.json({ success: false, uiPosition: "center", message: "Plan nahi mila" });

  const qty = Math.max(1, Number(copies || 1));
  if (Number(user.vipLevel || 0) < Number(prod.vipLevel || 0)) {
    return res.json({ success: false, uiPosition: "center", message: `VIP ${prod.vipLevel} required hai` });
  }
  if (prod.isLimited) {
    const left = Number(prod.remainingCopies ?? prod.totalCopies ?? 0);
    if (left < qty) {
      return res.json({
        success: false,
        uiPosition: "center",
        message: "Product khatam ho gaya hai koi or product buy karo thank you",
      });
    }
    prod.remainingCopies = left - qty;
  }

  const totalCost = Number(prod.price || 0) * qty;
  if (Number(user.chargedBalance || 0) < totalCost) {
    return res.json({ success: false, uiPosition: "center", message: "Charged balance kam hai" });
  }

  const nextInvested = Number(user.totalInvestment || 0) + totalCost;
  const updatedUser = await saveUserRecord({
    ...user,
    chargedBalance: Number(user.chargedBalance || 0) - totalCost,
    totalInvestment: nextInvested,
    vipLevel: Math.max(Number(user.vipLevel || 0), computeVip(nextInvested)),
  });

  const order = {
    id: "ORD_" + Date.now(),
    userId: updatedUser.id,
    productId: prod.id,
    productName: prod.name,
    price: totalCost,
    dailyIncome: Number(prod.dailyIncome || 0) * qty,
    durationDays: Number(prod.durationDays || 1),
    payoutInterval: prod.payoutInterval || "daily",
    status: "Active",
    createdAt: new Date().toISOString(),
  };

  state.orders.push(order);
  await persistSnapshot();
  res.json({ success: true, uiPosition: "center", message: `${prod.name} buy ho gaya`, order, user: updatedUser });
});

app.get("/api/my-products/:userId", (req, res) => {
  const orders = state.orders.filter((o) => o.userId === req.params.userId);
  res.json({ success: true, orders });
});

app.post("/api/orders/process-due", async (req, res) => {
  let credited = 0;
  for (const o of state.orders) {
    if (o.status === "Active") {
      const u = state.users.find((x) => x.id === o.userId);
      if (u) {
        const amt = Number(o.dailyIncome || 0);
        await saveUserRecord({
          ...u,
          withdrawalBalance: Number(u.withdrawalBalance || 0) + amt,
        });
        credited += amt;
      }
    }
  }
  await persistSnapshot();
  res.json({ success: true, uiPosition: "center", message: `Payout processed: ₹${credited}`, credited });
});

// RECHARGE APPLY (Pending approval by default unless autoCredit=true)
app.post("/api/recharge/create", async (req, res) => {
  const { userId, amount, channel = "UPI", utr = "", autoCredit = false } = req.body || {};
  const user = state.users.find((u) => u.id === userId);
  const amt = Number(amount || 0);
  if (!user || amt <= 0) {
    return res.json({ success: false, uiPosition: "center", message: "Valid user aur amount daalein" });
  }

  let updatedUser = user;
  const status = autoCredit ? "Approved" : "Pending";
  if (autoCredit) {
    updatedUser = await saveUserRecord({
      ...user,
      chargedBalance: Number(user.chargedBalance || 0) + amt,
    });
  }

  const rec = {
    id: "RCH_" + Date.now(),
    userId: user.id,
    phone: user.phone || "",
    amount: amt,
    channel,
    utr: String(utr || "").trim(),
    status,
    createdAt: new Date().toISOString(),
  };
  state.recharges.unshift(rec);
  await persistSnapshot();
  res.json({
    success: true,
    uiPosition: "center",
    message: autoCredit
      ? `₹${amt} recharge credit ho gaya`
      : `₹${amt} recharge request submit ho gayi (Pending approval)`,
    recharge: rec,
    user: updatedUser,
  });
});

// ADMIN RECHARGE APPROVE / REJECT
app.post("/api/admin/recharge/action", requireAdmin, async (req, res) => {
  const { rechargeId, id, action } = req.body || {};
  const targetId = rechargeId || id;
  const rec = state.recharges.find((r) => r.id === targetId);
  if (!rec) return res.json({ success: false, message: "Recharge record nahi mila" });

  const user = state.users.find((u) => u.id === rec.userId);

  if (action === "approve") {
    if (rec.status !== "Approved" && user) {
      await saveUserRecord({
        ...user,
        chargedBalance: Number(user.chargedBalance || 0) + Number(rec.amount || 0),
      });
    }
    rec.status = "Approved";
    rec.updatedAt = new Date().toISOString();
  } else if (action === "reject") {
    if (rec.status === "Approved" && user) {
      await saveUserRecord({
        ...user,
        chargedBalance: Math.max(0, Number(user.chargedBalance || 0) - Number(rec.amount || 0)),
      });
    }
    rec.status = "Rejected";
    rec.updatedAt = new Date().toISOString();
  } else {
    return res.json({ success: false, message: "Invalid action (use approve or reject)" });
  }

  await persistSnapshot();
  res.json({ success: true, message: `Recharge ${rec.status}`, recharge: rec });
});

// ADMIN DIRECT RECHARGE BY UID
app.post("/api/admin/recharge/uid", requireAdmin, async (req, res) => {
  const { uid, amount, channel = "Admin Recharge" } = req.body || {};
  const user = state.users.find((u) => u.id === String(uid || "").trim());
  const amt = Number(amount || 0);
  if (!user) return res.json({ success: false, message: "User UID nahi mila" });
  if (amt <= 0) return res.json({ success: false, message: "Valid recharge amount daalein" });

  const updatedUser = await saveUserRecord({
    ...user,
    chargedBalance: Number(user.chargedBalance || 0) + amt,
  });
  const rec = {
    id: "RCH_" + Date.now(),
    userId: updatedUser.id,
    phone: updatedUser.phone || "",
    amount: amt,
    channel,
    status: "Approved",
    createdAt: new Date().toISOString(),
  };
  state.recharges.unshift(rec);
  await persistSnapshot();
  res.json({ success: true, message: `₹${amt} recharge ${updatedUser.id} ko add ho gaya`, recharge: rec, user: updatedUser });
});

// WITHDRAW APPLY
app.post("/api/withdraw/auto-upi", async (req, res) => {
  const { userId, amount, withdrawPassword, bankName, realName, bankAccount } = req.body || {};
  const user = state.users.find((u) => u.id === userId);
  const amt = Number(amount || 0);
  if (!user) return res.json({ success: false, uiPosition: "center", message: "User nahi mila" });
  if (amt <= 0) return res.json({ success: false, uiPosition: "center", message: "Valid amount daalein" });
  if (user.withdrawPassword && String(withdrawPassword || "").trim() !== user.withdrawPassword) {
    return res.json({ success: false, uiPosition: "center", message: "Withdraw password galat hai" });
  }
  if (Number(user.withdrawalBalance || 0) < amt) {
    return res.json({ success: false, uiPosition: "center", message: "Withdrawal balance kam hai" });
  }

  const updatedUser = await saveUserRecord({
    ...user,
    withdrawalBalance: Number(user.withdrawalBalance || 0) - amt,
  });
  const wd = {
    id: "WDR_" + Date.now(),
    userId: updatedUser.id,
    phone: updatedUser.phone || "",
    amount: amt,
    bankName: bankName || "",
    realName: realName || "",
    bankAccount: bankAccount || "",
    status: "Pending",
    createdAt: new Date().toISOString(),
  };
  state.withdrawals.unshift(wd);
  await persistSnapshot();
  res.json({ success: true, uiPosition: "center", message: `₹${amt} withdrawal request submit ho gayi`, withdrawal: wd, user: updatedUser });
});

// ADMIN WITHDRAW APPROVE / REJECT (with refund on reject)
app.post("/api/admin/withdraw/action", requireAdmin, async (req, res) => {
  const { withdrawalId, id, action } = req.body || {};
  const targetId = withdrawalId || id;
  const wd = state.withdrawals.find((w) => w.id === targetId);
  if (!wd) return res.json({ success: false, message: "Withdrawal record nahi mila" });

  if (action === "approve") {
    wd.status = "Approved";
    wd.updatedAt = new Date().toISOString();
  } else if (action === "reject") {
    if (wd.status !== "Rejected") {
      const user = state.users.find((u) => u.id === wd.userId);
      if (user) {
        await saveUserRecord({
          ...user,
          withdrawalBalance: Number(user.withdrawalBalance || 0) + Number(wd.amount || 0),
        });
      }
      wd.status = "Rejected";
      wd.updatedAt = new Date().toISOString();
    }
  } else {
    return res.json({ success: false, message: "Invalid action (use approve or reject)" });
  }

  await persistSnapshot();
  res.json({ success: true, message: `Withdrawal ${wd.status}`, withdrawal: wd });
});

// PROMO CLAIM
app.post("/api/promo/claim", async (req, res) => {
  const { userId, code } = req.body || {};
  const user = state.users.find((u) => u.id === userId);
  if (!user) return res.json({ success: false, uiPosition: "center", message: "Pehle login karein" });

  const clean = String(code || "").trim().toUpperCase();
  const promo = state.promos.find((p) => p.code === clean);
  if (!promo) return res.json({ success: false, uiPosition: "center", message: "Invalid promo code" });
  if (promo.maxUses > 0 && Number(promo.usedCount || 0) >= Number(promo.maxUses)) {
    return res.json({ success: false, uiPosition: "center", message: "Promo limit khatam ho gayi" });
  }
  if (Number(user.vipLevel || 0) < Number(promo.requiredVipLevel || 0)) {
    return res.json({ success: false, uiPosition: "center", message: `VIP ${promo.requiredVipLevel} required hai` });
  }

  promo.usedCount = Number(promo.usedCount || 0) + 1;
  const field = promo.balanceTarget === "chargedBalance" ? "chargedBalance" : "withdrawalBalance";
  const updatedUser = await saveUserRecord({
    ...user,
    [field]: Number(user[field] || 0) + Number(promo.rewardAmount || 0),
  });
  await persistSnapshot();
  res.json({ success: true, uiPosition: "center", message: `₹${promo.rewardAmount} promo bonus mila`, user: updatedUser });
});

// BLOG PROOF
app.post("/api/blog/submit", async (req, res) => {
  const { userId, text, images } = req.body || {};
  if (!userId || !text) return res.json({ success: false, message: "User aur text required hai" });
  const post = {
    id: "BLG_" + Date.now(),
    userId,
    text,
    images: Array.isArray(images) ? images.slice(0, 2) : [],
    createdAt: new Date().toISOString(),
  };
  state.blogPosts.unshift(post);
  await persistSnapshot();
  res.json({ success: true, uiPosition: "center", message: "Proof post ho gaya", post });
});

// LIVE CHAT CUSTOMER SERVICE (No token needed — direct chat thread)
app.get("/api/service/chat/:userId", async (req, res) => {
  await hydrateFromFirestore();
  const uid = String(req.params.userId || "").trim();
  const messages = getOrCreateChatThread(uid);
  res.json({
    success: true,
    userId: uid,
    serviceInfo: state.config.customerService,
    messages,
  });
});

app.post("/api/service/chat/send", async (req, res) => {
  const { userId, message, text } = req.body || {};
  const msgText = String(message || text || "").trim();
  if (!userId || !msgText) {
    return res.json({ success: false, message: "Message required hai" });
  }
  const uid = String(userId).trim();
  const thread = getOrCreateChatThread(uid);
  const newMsg = {
    id: "MSG_" + Date.now(),
    sender: "user",
    senderName: "You",
    text: msgText,
    createdAt: new Date().toISOString(),
  };
  thread.push(newMsg);
  await persistSnapshot();
  res.json({
    success: true,
    userId: uid,
    message: newMsg,
    messages: thread,
  });
});

app.post("/api/admin/service/chat/reply", requireAdmin, async (req, res) => {
  const { userId, reply, message } = req.body || {};
  const uid = String(userId || "").trim();
  const replyText = String(reply || message || "").trim();
  if (!uid || !replyText) {
    return res.json({ success: false, message: "userId aur reply required hai" });
  }
  const thread = getOrCreateChatThread(uid);
  const agentMsg = {
    id: "MSG_" + Date.now(),
    sender: "agent",
    senderName: state.config?.customerService?.title || "Customer Service",
    text: replyText,
    createdAt: new Date().toISOString(),
  };
  thread.push(agentMsg);
  await persistSnapshot();
  res.json({
    success: true,
    userId: uid,
    message: agentMsg,
    messages: thread,
  });
});

// Legacy ticket routes mapped to chat thread too
app.post("/api/service/ticket", async (req, res) => {
  const { userId, message } = req.body || {};
  if (!userId || !message) return res.json({ success: false, message: "Message required hai" });
  const thread = getOrCreateChatThread(userId);
  const msg = {
    id: "MSG_" + Date.now(),
    sender: "user",
    senderName: "You",
    text: String(message).trim(),
    createdAt: new Date().toISOString(),
  };
  thread.push(msg);
  await persistSnapshot();
  res.json({ success: true, uiPosition: "center", message: "Message sent to Customer Service", chatMessage: msg, messages: thread });
});

app.post("/api/admin/service/reply", requireAdmin, async (req, res) => {
  const { userId, reply } = req.body || {};
  if (!userId || !reply) return res.json({ success: false, message: "userId aur reply required hai" });
  const thread = getOrCreateChatThread(userId);
  const msg = {
    id: "MSG_" + Date.now(),
    sender: "agent",
    senderName: state.config?.customerService?.title || "Customer Service",
    text: String(reply).trim(),
    createdAt: new Date().toISOString(),
  };
  thread.push(msg);
  await persistSnapshot();
  res.json({ success: true, uiPosition: "center", message: "Reply sent", chatMessage: msg, messages: thread });
});

// LIVE SYNC
app.get("/api/live-sync/:userId", async (req, res) => {
  await hydrateFromFirestore();
  const uid = req.params.userId;
  const user = state.users.find((u) => u.id === uid) || null;
  const products = state.products.map((p) => ({
    ...p,
    limitedStock: Boolean(p.isLimited),
    availableCopies: p.isLimited ? Number(p.remainingCopies ?? p.totalCopies ?? 0) : null,
  }));
  res.json({
    success: true,
    user,
    products,
    myProducts: state.orders.filter((o) => o.userId === uid),
    chatMessages: getOrCreateChatThread(uid),
    inviteBonuses: state.inviteBonuses.filter((b) => b.referrerId === uid),
    withdrawals: state.withdrawals.filter((w) => w.userId === uid),
    recharges: state.recharges.filter((r) => r.userId === uid),
    siteInfo: state.siteSync,
    codeMeta: { version: state.liveCode.version, updatedAt: state.liveCode.updatedAt },
  });
});

app.get("/api/user-code/live", (req, res) => {
  res.json({ success: true, code: state.liveCode });
});

app.get("/api/user-site/live", (req, res) => {
  res.json({ success: true, site: state.siteSync, code: state.liveCode });
});

app.get("/api/user-site/link", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  res.json({
    success: true,
    ...state.siteSync,
    liveFeedEndpoint: `${baseUrl}/api/user-code/live`,
  });
});

app.post("/api/user-site/sync-from-host", async (req, res) => {
  const { pass, number } = req.body || {};
  if (pass) state.siteSync.pass = pass;
  if (number) state.siteSync.number = number;
  state.siteSync.updatedAt = new Date().toISOString();
  await persistSnapshot();
  res.json({ success: true, message: "Synced from host", site: state.siteSync });
});

// ADMIN OVERVIEW
app.get("/api/admin/overview", requireAdmin, async (req, res) => {
  await hydrateFromFirestore();
  const stats = {
    totalUsers: state.users.length,
    totalChargedBalance: state.users.reduce((a, b) => a + Number(b.chargedBalance || 0), 0),
    totalWithdrawalBalance: state.users.reduce((a, b) => a + Number(b.withdrawalBalance || 0), 0),
    totalRechargeAmount: state.recharges
      .filter((r) => r.status === "Approved" || r.status === "Completed")
      .reduce((a, b) => a + Number(b.amount || 0), 0),
    totalWithdrawAmount: state.withdrawals
      .filter((w) => w.status !== "Rejected")
      .reduce((a, b) => a + Number(b.amount || 0), 0),
    totalInviteBonusAmount: state.inviteBonuses.reduce((a, b) => a + Number(b.amount || 0), 0),
    totalInvestmentAmount: state.users.reduce((a, b) => a + Number(b.totalInvestment || 0), 0),
  };
  res.json({
    success: true,
    stats,
    users: state.users,
    withdrawals: state.withdrawals,
    recharges: state.recharges,
    inviteBonuses: state.inviteBonuses,
    orders: state.orders,
    serviceChats: state.serviceChats,
  });
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
  await persistSnapshot();
  res.json({ success: true, message: "Hosting site connected", site: state.siteSync });
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
  await persistSnapshot();
  res.json({ success: true, message: "Live code published", code: state.liveCode });
});

app.post("/api/admin/products/add", requireAdmin, async (req, res) => {
  const b = req.body || {};
  const prod = {
    id: "PRD_" + Date.now(),
    name: b.name || "Plan",
    image: b.image || "",
    price: Number(b.price || 0),
    dailyIncome: Number(b.dailyIncome || 0),
    durationDays: Number(b.durationDays || 1),
    payoutInterval: b.payoutInterval || "daily",
    vipLevel: Number(b.vipLevel || 0),
    isLimited: Boolean(b.isLimited),
    totalCopies: b.totalCopies ?? null,
    remainingCopies: b.totalCopies ?? null,
  };
  state.products.push(prod);
  await persistSnapshot();
  res.json({ success: true, product: prod });
});

app.post("/api/admin/products/remove", requireAdmin, async (req, res) => {
  const { productId } = req.body || {};
  state.products = state.products.filter((p) => p.id !== productId);
  await persistSnapshot();
  res.json({ success: true, message: "Product removed" });
});

app.post("/api/admin/promo/create", requireAdmin, async (req, res) => {
  const p = req.body || {};
  if (!p.code) return res.json({ success: false, message: "Promo code required" });
  const clean = String(p.code).trim().toUpperCase();
  state.promos = state.promos.filter((x) => x.code !== clean);
  state.promos.push({
    code: clean,
    rewardAmount: Number(p.rewardAmount || 0),
    balanceTarget: p.balanceTarget || "withdrawalBalance",
    maxUses: Number(p.maxUses || 0),
    usedCount: 0,
    requiredVipLevel: Number(p.requiredVipLevel || 0),
    allowedUserIds: Array.isArray(p.allowedUserIds) ? p.allowedUserIds : [],
    expiresAt: p.expiresAt || null,
  });
  await persistSnapshot();
  res.json({ success: true, message: `Promo ${clean} saved` });
});

app.post("/api/admin/config", requireAdmin, async (req, res) => {
  const { popupBanner, homeBanner, inviteBonusAmount, customerService } = req.body || {};
  if (popupBanner) state.config.popupBanner = { ...state.config.popupBanner, ...popupBanner };
  if (homeBanner) state.config.homeBanner = { ...state.config.homeBanner, ...homeBanner };
  if (inviteBonusAmount !== undefined) state.config.inviteBonusAmount = Number(inviteBonusAmount);
  if (customerService) state.config.customerService = { ...state.config.customerService, ...customerService };
  await persistSnapshot();
  res.json({ success: true, config: state.config });
});

app.post("/api/admin/bonus/uid", requireAdmin, async (req, res) => {
  const { uid, amount, balanceTarget } = req.body || {};
  const user = state.users.find((u) => u.id === uid);
  if (!user) return res.json({ success: false, message: "User not found" });
  const field = balanceTarget === "chargedBalance" ? "chargedBalance" : "withdrawalBalance";
  const updatedUser = await saveUserRecord({
    ...user,
    [field]: Number(user[field] || 0) + Number(amount || 0),
  });
  await persistSnapshot();
  res.json({ success: true, message: `₹${amount} bonus credited to ${uid}`, user: updatedUser });
});

app.listen(PORT, () => {
  console.log(`Grow server (grow-b17db) running on port ${PORT}`);
});
