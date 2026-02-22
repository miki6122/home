const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 4173;

const MAX_HISTORY = 200;
const OTP_TTL_MS = 5 * 60 * 1000;

const users = new Map();
const sessions = new Map();
const pendingVerifications = new Map();
const messages = [];
const urgent = [];
const supportMessages = [];

const addHistory = (arr, item) => {
  arr.push(item);
  if (arr.length > MAX_HISTORY) arr.shift();
};

const nowIso = () => new Date().toISOString();
const randomCode = () => String(Math.floor(100000 + Math.random() * 900000));

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
  });

const findUserByPhone = (phone) => [...users.values()].find((u) => u.phone && u.phone === phone);
const findUserByEmail = (email) => [...users.values()].find((u) => u.email && u.email === email);

const getSessionUser = (token) => {
  const userId = token ? sessions.get(token) : null;
  return userId ? users.get(userId) : null;
};

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  phone: u.phone || null,
  email: u.email || null,
  isGuest: Boolean(u.isGuest),
  role: u.role,
  blocked: Boolean(u.blocked),
  createdAt: u.createdAt,
});

const authGuard = (req, res, parsed) => {
  const token = parsed.searchParams.get('token') || req.headers['x-token'];
  const me = getSessionUser(token);
  if (!me) {
    sendJson(res, 401, { error: 'unauthorized' });
    return null;
  }
  if (me.blocked) {
    sendJson(res, 403, { error: 'user blocked by admin' });
    return null;
  }
  return { token, me };
};

const adminGuard = (req, res, parsed) => {
  const auth = authGuard(req, res, parsed);
  if (!auth) return null;
  if (auth.me.role !== 'admin') {
    sendJson(res, 403, { error: 'admin only' });
    return null;
  }
  return auth;
};

const serveStatic = (res, pathname) => {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(process.cwd(), safePath);

  if (!filePath.startsWith(process.cwd())) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    const typeMap = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
    };

    res.writeHead(200, { 'Content-Type': typeMap[ext] || 'application/octet-stream' });
    res.end(content);
  });
};

const bootstrapAdmin = () => {
  const adminUser = {
    id: crypto.randomUUID(),
    name: 'Адмін',
    phone: '+380000000000',
    email: 'admin@chat.local',
    isGuest: false,
    role: 'admin',
    blocked: false,
    createdAt: nowIso(),
  };
  users.set(adminUser.id, adminUser);
};
bootstrapAdmin();

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname;

  if (req.method === 'POST' && pathname === '/api/auth/guest') {
    try {
      const { name } = await readBody(req);
      const displayName = String(name || '').trim() || `Гість-${Math.floor(Math.random() * 900 + 100)}`;
      const user = {
        id: crypto.randomUUID(),
        name: displayName,
        phone: null,
        email: null,
        isGuest: true,
        role: 'user',
        blocked: false,
        createdAt: nowIso(),
      };
      users.set(user.id, user);

      const token = crypto.randomUUID();
      sessions.set(token, user.id);
      return sendJson(res, 200, { token, profile: publicUser(user) });
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/start') {
    try {
      const { action, name, method, phone, email } = await readBody(req);
      const m = method === 'email' ? 'email' : 'phone';
      const trimmedName = String(name || '').trim();
      const targetPhone = String(phone || '').trim();
      const targetEmail = String(email || '').trim().toLowerCase();

      if (!trimmedName) return sendJson(res, 400, { error: 'name required' });
      if (m === 'phone' && !targetPhone) return sendJson(res, 400, { error: 'phone required' });
      if (m === 'email' && !targetEmail) return sendJson(res, 400, { error: 'email required' });

      const requestedAction = action === 'login' ? 'login' : 'register';
      const existing = m === 'phone' ? findUserByPhone(targetPhone) : findUserByEmail(targetEmail);

      if (requestedAction === 'register' && existing) {
        return sendJson(res, 409, { error: m === 'phone' ? 'phone already registered' : 'email already registered' });
      }
      if (requestedAction === 'login' && !existing) {
        return sendJson(res, 404, { error: m === 'phone' ? 'phone not found' : 'email not found' });
      }

      const code = randomCode();
      const pendingId = crypto.randomUUID();
      pendingVerifications.set(pendingId, {
        pendingId,
        action: requestedAction,
        existingUserId: existing ? existing.id : null,
        name: trimmedName,
        method: m,
        phone: m === 'phone' ? targetPhone : null,
        email: m === 'email' ? targetEmail : null,
        code,
        expiresAt: Date.now() + OTP_TTL_MS,
      });

      return sendJson(res, 200, {
        pendingId,
        message: m === 'phone' ? 'SMS код відправлено (демо)' : 'Код на email відправлено (демо)',
        demoCode: code,
      });
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/verify') {
    try {
      const { pendingId, code } = await readBody(req);
      const pending = pendingVerifications.get(String(pendingId || ''));
      if (!pending) return sendJson(res, 404, { error: 'verification not found' });
      if (Date.now() > pending.expiresAt) {
        pendingVerifications.delete(pending.pendingId);
        return sendJson(res, 410, { error: 'verification expired' });
      }
      if (String(code || '').trim() !== pending.code) return sendJson(res, 400, { error: 'wrong code' });

      let user;
      if (pending.action === 'login') {
        user = users.get(pending.existingUserId);
        if (!user) return sendJson(res, 404, { error: 'user not found' });
      } else {
        if (pending.phone && findUserByPhone(pending.phone)) return sendJson(res, 409, { error: 'phone already registered' });
        if (pending.email && findUserByEmail(pending.email)) return sendJson(res, 409, { error: 'email already registered' });

        user = {
          id: crypto.randomUUID(),
          name: pending.name,
          phone: pending.phone,
          email: pending.email,
          isGuest: false,
          role: 'user',
          blocked: false,
          createdAt: nowIso(),
        };
        users.set(user.id, user);
      }
      pendingVerifications.delete(pending.pendingId);

      const token = crypto.randomUUID();
      sessions.set(token, user.id);
      return sendJson(res, 200, { token, profile: publicUser(user) });
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    const auth = authGuard(req, res, parsed);
    if (!auth) return;

    const usersList = [...users.values()].filter((u) => !u.blocked).map(publicUser);
    const visibleUrgent = urgent.filter((u) => u.mode === 'global' || u.senderId === auth.me.id || u.targetUserId === auth.me.id);
    const visibleSupport = supportMessages.filter((m) => auth.me.role === 'admin' || m.userId === auth.me.id);

    return sendJson(res, 200, {
      me: publicUser(auth.me),
      users: usersList,
      messages,
      urgent: visibleUrgent,
      support: visibleSupport,
    });
  }

  if (req.method === 'POST' && pathname === '/api/chat/send') {
    try {
      const { token, text } = await readBody(req);
      const me = getSessionUser(token);
      if (!me) return sendJson(res, 401, { error: 'unauthorized' });
      if (me.blocked) return sendJson(res, 403, { error: 'user blocked by admin' });
      const clean = String(text || '').trim();
      if (!clean) return sendJson(res, 400, { error: 'text required' });

      addHistory(messages, {
        id: crypto.randomUUID(),
        text: clean,
        createdAt: nowIso(),
        senderId: me.id,
        senderName: me.name,
        senderPhone: me.phone,
        senderEmail: me.email,
      });

      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/urgent/send') {
    try {
      const { token, mode, text, targetUserId } = await readBody(req);
      const me = getSessionUser(token);
      if (!me) return sendJson(res, 401, { error: 'unauthorized' });
      if (me.blocked) return sendJson(res, 403, { error: 'user blocked by admin' });
      const clean = String(text || '').trim();
      if (!clean) return sendJson(res, 400, { error: 'text required' });

      const normalizedMode = mode === 'personal' ? 'personal' : 'global';
      let targetId = null;
      if (normalizedMode === 'personal') {
        const target = users.get(String(targetUserId || ''));
        if (!target || target.blocked) return sendJson(res, 400, { error: 'target user not found' });
        targetId = target.id;
      }

      addHistory(urgent, {
        id: crypto.randomUUID(),
        mode: normalizedMode,
        text: clean,
        createdAt: nowIso(),
        senderId: me.id,
        senderName: me.name,
        targetUserId: targetId,
      });

      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/support/send') {
    try {
      const { token, text } = await readBody(req);
      const me = getSessionUser(token);
      if (!me) return sendJson(res, 401, { error: 'unauthorized' });
      const clean = String(text || '').trim();
      if (!clean) return sendJson(res, 400, { error: 'text required' });

      addHistory(supportMessages, {
        id: crypto.randomUUID(),
        userId: me.id,
        userName: me.name,
        text: clean,
        answer: null,
        answeredBy: null,
        createdAt: nowIso(),
      });

      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/support/reply') {
    try {
      const { token, supportId, answer } = await readBody(req);
      const admin = getSessionUser(token);
      if (!admin) return sendJson(res, 401, { error: 'unauthorized' });
      if (admin.role !== 'admin') return sendJson(res, 403, { error: 'admin only' });

      const msg = supportMessages.find((m) => m.id === String(supportId || ''));
      if (!msg) return sendJson(res, 404, { error: 'support message not found' });
      msg.answer = String(answer || '').trim();
      msg.answeredBy = admin.name;

      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }
  }

  if (req.method === 'GET' && pathname === '/api/admin/users') {
    const auth = adminGuard(req, res, parsed);
    if (!auth) return;
    return sendJson(res, 200, { users: [...users.values()].map(publicUser) });
  }

  if (req.method === 'POST' && pathname === '/api/admin/block') {
    try {
      const { token, userId, blocked } = await readBody(req);
      const admin = getSessionUser(token);
      if (!admin || admin.role !== 'admin') return sendJson(res, 403, { error: 'admin only' });
      const user = users.get(String(userId || ''));
      if (!user) return sendJson(res, 404, { error: 'user not found' });
      if (user.role === 'admin') return sendJson(res, 400, { error: 'cannot block admin' });
      user.blocked = Boolean(blocked);
      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/admin/kick') {
    try {
      const { token, userId } = await readBody(req);
      const admin = getSessionUser(token);
      if (!admin || admin.role !== 'admin') return sendJson(res, 403, { error: 'admin only' });
      const user = users.get(String(userId || ''));
      if (!user) return sendJson(res, 404, { error: 'user not found' });
      if (user.role === 'admin') return sendJson(res, 400, { error: 'cannot kick admin' });

      for (const [sessionToken, uid] of sessions.entries()) {
        if (uid === user.id) sessions.delete(sessionToken);
      }

      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    try {
      const { token } = await readBody(req);
      sessions.delete(token);
      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }
  }

  serveStatic(res, pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log('Admin demo login: +380000000000 / admin@chat.local');
});
