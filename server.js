const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 4173;

const sessions = new Map();
const messages = [];
const urgent = [];
const MAX_HISTORY = 200;

const addHistory = (arr, item) => {
  arr.push(item);
  if (arr.length > MAX_HISTORY) arr.shift();
};

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

const getSession = (token) => (token ? sessions.get(token) : null);

const serveStatic = (req, res, pathname) => {
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

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname;

  if (req.method === 'POST' && pathname === '/api/register') {
    try {
      const { name, phone } = await readBody(req);
      if (!name || !phone) return sendJson(res, 400, { error: 'name and phone are required' });

      const token = crypto.randomUUID();
      const user = { name: String(name).trim(), phone: String(phone).trim(), token };
      sessions.set(token, user);

      return sendJson(res, 200, { token, profile: { name: user.name, phone: user.phone } });
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }
  }

  if (req.method === 'GET' && pathname === '/api/state') {
    const token = parsed.searchParams.get('token');
    const me = getSession(token);
    if (!me) return sendJson(res, 401, { error: 'unauthorized' });

    const users = Array.from(new Map([...sessions.values()].map((u) => [u.phone, { name: u.name, phone: u.phone }])).values());
    const visibleUrgent = urgent.filter((u) => u.mode === 'global' || u.senderPhone === me.phone || u.targetPhone === me.phone);

    return sendJson(res, 200, { me: { name: me.name, phone: me.phone }, users, messages, urgent: visibleUrgent });
  }

  if (req.method === 'POST' && pathname === '/api/chat/send') {
    try {
      const { token, text } = await readBody(req);
      const me = getSession(token);
      if (!me) return sendJson(res, 401, { error: 'unauthorized' });
      if (!text) return sendJson(res, 400, { error: 'text required' });

      addHistory(messages, {
        id: crypto.randomUUID(),
        text: String(text).trim(),
        createdAt: new Date().toISOString(),
        senderName: me.name,
        senderPhone: me.phone,
      });

      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 400, { error: 'invalid json' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/urgent/send') {
    try {
      const { token, mode, text, targetPhone } = await readBody(req);
      const me = getSession(token);
      if (!me) return sendJson(res, 401, { error: 'unauthorized' });
      if (!text) return sendJson(res, 400, { error: 'text required' });

      const normalizedMode = mode === 'personal' ? 'personal' : 'global';
      const normalizedTarget = normalizedMode === 'personal' ? String(targetPhone || '').trim() : null;
      if (normalizedMode === 'personal' && !normalizedTarget) {
        return sendJson(res, 400, { error: 'targetPhone required for personal' });
      }

      addHistory(urgent, {
        id: crypto.randomUUID(),
        mode: normalizedMode,
        text: String(text).trim(),
        createdAt: new Date().toISOString(),
        senderName: me.name,
        senderPhone: me.phone,
        targetPhone: normalizedTarget,
      });

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

  serveStatic(req, res, pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
