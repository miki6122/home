const ui = {
  authSection: document.getElementById('authSection'),
  authForm: document.getElementById('authForm'),
  authMethod: document.getElementById('authMethod'),
  phoneWrap: document.getElementById('phoneWrap'),
  emailWrap: document.getElementById('emailWrap'),
  passwordWrap: document.getElementById('passwordWrap'),
  verifyForm: document.getElementById('verifyForm'),
  demoCode: document.getElementById('demoCode'),
  guestBtn: document.getElementById('guestBtn'),
  adminLoginForm: document.getElementById('adminLoginForm'),
  profileSection: document.getElementById('profileSection'),
  myProfile: document.getElementById('myProfile'),
  logoutBtn: document.getElementById('logoutBtn'),
  onlineUsers: document.getElementById('onlineUsers'),
  tabs: document.getElementById('tabs'),
  tabButtons: document.querySelectorAll('.tab-btn'),
  adminTab: document.querySelector('.tab-btn[data-tab="admin"]'),
  chatSection: document.getElementById('chatSection'),
  urgentSection: document.getElementById('urgentSection'),
  supportSection: document.getElementById('supportSection'),
  adminSection: document.getElementById('adminSection'),
  messages: document.getElementById('messages'),
  messageForm: document.getElementById('messageForm'),
  urgentForm: document.getElementById('urgentForm'),
  urgentMode: document.getElementById('urgentMode'),
  targetUserWrap: document.getElementById('targetUserWrap'),
  targetUserSelect: document.getElementById('targetUserSelect'),
  urgentHistory: document.getElementById('urgentHistory'),
  supportForm: document.getElementById('supportForm'),
  supportList: document.getElementById('supportList'),
  adminUsers: document.getElementById('adminUsers'),
  urgentOverlay: document.getElementById('urgentOverlay'),
  urgentOverlayText: document.getElementById('urgentOverlayText'),
  closeOverlay: document.getElementById('closeOverlay'),
};

const storageKey = 'chat_token';
let token = localStorage.getItem(storageKey);
let me = null;
let pendingId = null;
let activeTab = 'chat';
let seenUrgentIds = new Set();

const formatTime = (iso) => new Date(iso).toLocaleString('uk-UA');
const contactText = (u) => [u.phone, u.email].filter(Boolean).join(' / ') || 'гість';

const api = async (url, method = 'GET', body) => {
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'API error');
  return data;
};

const showTab = (tab) => {
  activeTab = tab;
  ui.tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  ui.chatSection.classList.toggle('hidden', tab !== 'chat');
  ui.urgentSection.classList.toggle('hidden', tab !== 'urgent');
  ui.supportSection.classList.toggle('hidden', tab !== 'support');
  ui.adminSection.classList.toggle('hidden', tab !== 'admin');
};

const setLoggedOutUI = () => {
  ui.authSection.classList.remove('hidden');
  ui.profileSection.classList.add('hidden');
  ui.tabs.classList.add('hidden');
  ui.chatSection.classList.add('hidden');
  ui.urgentSection.classList.add('hidden');
  ui.supportSection.classList.add('hidden');
  ui.adminSection.classList.add('hidden');
};

const setLoggedInUI = () => {
  ui.authSection.classList.add('hidden');
  ui.profileSection.classList.remove('hidden');
  ui.tabs.classList.remove('hidden');
  ui.adminTab.classList.toggle('hidden', me.role !== 'admin');
  if (me.role !== 'admin' && activeTab === 'admin') activeTab = 'chat';
  showTab(activeTab);
  ui.myProfile.textContent = `${me.name} (${contactText(me)})${me.isGuest ? ' [гість]' : ''}${me.role === 'admin' ? ' [адмін]' : ''}`;
};

const renderUsers = (users) => {
  ui.onlineUsers.innerHTML = '';
  ui.targetUserSelect.innerHTML = '';
  users.filter((u) => !u.blocked).forEach((u) => {
    const pill = document.createElement('div');
    pill.className = 'user-pill';
    pill.textContent = `${u.name} (${contactText(u)})`;
    ui.onlineUsers.append(pill);

    if (u.id !== me.id) {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${u.name} (${contactText(u)})`;
      ui.targetUserSelect.append(opt);
    }
  });
};

const renderMessages = (messages) => {
  ui.messages.innerHTML = '';
  messages.forEach((m) => {
    const item = document.createElement('article');
    item.className = `message ${m.senderId === me.id ? 'mine' : ''}`;
    item.innerHTML = `<div>${m.text}</div><div class='meta'>${m.senderName} • ${formatTime(m.createdAt)}</div>`;
    ui.messages.append(item);
  });
  ui.messages.scrollTop = ui.messages.scrollHeight;
};

const renderUrgent = (items) => {
  ui.urgentHistory.innerHTML = '';
  items.slice().reverse().forEach((u) => {
    const item = document.createElement('article');
    item.className = `urgent-item ${u.mode}`;
    item.innerHTML = `<strong>${u.mode === 'global' ? 'ЗАГАЛЬНЕ' : 'ПЕРСОНАЛЬНЕ'}</strong><div>${u.text}</div><div class='meta'>${u.senderName} • ${formatTime(u.createdAt)}</div>`;
    ui.urgentHistory.append(item);
  });

  const fresh = items.filter((x) => !seenUrgentIds.has(x.id));
  fresh.forEach((x) => seenUrgentIds.add(x.id));
  if (fresh.length) {
    ui.urgentOverlayText.textContent = fresh[fresh.length - 1].text;
    ui.urgentOverlay.classList.remove('hidden');
  }
};

const renderSupport = (items) => {
  ui.supportList.innerHTML = '';
  items.slice().reverse().forEach((s) => {
    const box = document.createElement('article');
    box.className = 'support-item';
    box.innerHTML = `<div><strong>${s.userName}</strong>: ${s.text}</div><div class='meta'>${formatTime(s.createdAt)}</div><div>${s.answer ? `✅ ${s.answeredBy}: ${s.answer}` : '⏳ Очікує відповіді адміна'}</div>`;

    if (me.role === 'admin') {
      const form = document.createElement('form');
      form.className = 'row-form top-gap';
      form.innerHTML = `<input placeholder='${s.answer ? 'Оновити відповідь...' : 'Відповідь...'}' required /><button type='submit'>${s.answer ? 'Оновити' : 'Відповісти'}</button>`;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = form.querySelector('input');
        try {
          await api('/api/support/reply', 'POST', { token, supportId: s.id, answer: input.value.trim() });
          await syncState();
        } catch (err) {
          alert(err.message);
        }
      });
      box.append(form);
    }

    ui.supportList.append(box);
  });
};

const renderAdminUsers = async () => {
  if (me.role !== 'admin') return;
  const data = await api(`/api/admin/users?token=${encodeURIComponent(token)}`);
  ui.adminUsers.innerHTML = '';
  data.users.forEach((u) => {
    const row = document.createElement('div');
    row.className = 'admin-row';
    row.innerHTML = `<div>${u.name} (${contactText(u)}) ${u.blocked ? '🚫' : ''} ${u.role === 'admin' ? '[адмін]' : ''}</div>`;
    if (u.role !== 'admin') {
      const blockBtn = document.createElement('button');
      blockBtn.className = 'secondary';
      blockBtn.textContent = u.blocked ? 'Розблокувати' : 'Заблокувати';
      blockBtn.onclick = async () => {
        await api('/api/admin/block', 'POST', { token, userId: u.id, blocked: !u.blocked });
        await syncState();
      };

      const kickBtn = document.createElement('button');
      kickBtn.className = 'danger';
      kickBtn.textContent = 'Вигнати';
      kickBtn.onclick = async () => {
        await api('/api/admin/kick', 'POST', { token, userId: u.id });
        await syncState();
      };
      row.append(blockBtn, kickBtn);
    }
    ui.adminUsers.append(row);
  });
};

const syncState = async () => {
  if (!token) return;
  try {
    const s = await api(`/api/state?token=${encodeURIComponent(token)}`);
    me = s.me;
    setLoggedInUI();
    renderUsers(s.users);
    renderMessages(s.messages);
    renderUrgent(s.urgent);
    renderSupport(s.support);
    await renderAdminUsers();
  } catch {
    localStorage.removeItem(storageKey);
    token = null;
    me = null;
    setLoggedOutUI();
  }
};

ui.authMethod.addEventListener('change', () => {
  const isPhone = ui.authMethod.value === 'phone';
  ui.phoneWrap.classList.toggle('hidden', !isPhone);
  ui.emailWrap.classList.toggle('hidden', isPhone);
});

ui.authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const f = new FormData(ui.authForm);
    const res = await api('/api/auth/start', 'POST', {
      action: String(f.get('action') || 'register'),
      name: String(f.get('name')).trim(),
      method: String(f.get('method')),
      phone: String(f.get('phone') || '').trim(),
      email: String(f.get('email') || '').trim(),
      password: String(f.get('password') || ''),
    });
    pendingId = res.pendingId;
    ui.verifyForm.classList.remove('hidden');
    ui.demoCode.textContent = res.demoCode;
    alert(res.message);
  } catch (err) {
    alert(err.message);
  }
});

ui.verifyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const f = new FormData(ui.verifyForm);
    const res = await api('/api/auth/verify', 'POST', { pendingId, code: String(f.get('code')).trim() });
    token = res.token;
    localStorage.setItem(storageKey, token);
    ui.verifyForm.classList.add('hidden');
    await syncState();
  } catch (err) {
    alert(err.message);
  }
});

ui.guestBtn.addEventListener('click', async () => {
  try {
    const name = prompt('Імʼя гостя:', 'Гість');
    const res = await api('/api/auth/guest', 'POST', { name });
    token = res.token;
    localStorage.setItem(storageKey, token);
    await syncState();
  } catch (err) {
    alert(err.message);
  }
});


ui.adminLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const f = new FormData(ui.adminLoginForm);
    const res = await api('/api/auth/password-login', 'POST', {
      identifier: 'admin@chat.local',
      password: String(f.get('adminPassword') || ''),
    });
    token = res.token;
    localStorage.setItem(storageKey, token);
    await syncState();
  } catch (err) {
    alert(err.message);
  }
});

ui.logoutBtn.addEventListener('click', async () => {
  if (token) await api('/api/logout', 'POST', { token });
  localStorage.removeItem(storageKey);
  token = null;
  me = null;
  setLoggedOutUI();
});

ui.messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(ui.messageForm);
  await api('/api/chat/send', 'POST', { token, text: String(f.get('message')).trim() });
  ui.messageForm.reset();
  await syncState();
});

ui.urgentMode.addEventListener('change', () => {
  ui.targetUserWrap.classList.toggle('hidden', ui.urgentMode.value !== 'personal');
});

ui.urgentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(ui.urgentForm);
  await api('/api/urgent/send', 'POST', {
    token,
    mode: String(f.get('mode')),
    text: String(f.get('urgentText')).trim(),
    targetUserId: String(f.get('targetUserId') || ''),
  });
  ui.urgentForm.reset();
  ui.targetUserWrap.classList.add('hidden');
  await syncState();
});

ui.supportForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(ui.supportForm);
  await api('/api/support/send', 'POST', { token, text: String(f.get('text')).trim() });
  ui.supportForm.reset();
  await syncState();
});

ui.tabButtons.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
ui.closeOverlay.addEventListener('click', () => ui.urgentOverlay.classList.add('hidden'));

if (token) syncState();
else setLoggedOutUI();
setInterval(syncState, 1500);
