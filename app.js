const ui = {
  registrationSection: document.getElementById('registrationSection'),
  profileSection: document.getElementById('profileSection'),
  registrationForm: document.getElementById('registrationForm'),
  myProfile: document.getElementById('myProfile'),
  onlineUsers: document.getElementById('onlineUsers'),
  tabs: document.getElementById('tabs'),
  tabButtons: document.querySelectorAll('.tab-btn'),
  chatSection: document.getElementById('chatSection'),
  urgentSection: document.getElementById('urgentSection'),
  messages: document.getElementById('messages'),
  messageForm: document.getElementById('messageForm'),
  callBtn: document.getElementById('callBtn'),
  urgentForm: document.getElementById('urgentForm'),
  urgentMode: document.getElementById('urgentMode'),
  targetPhoneWrap: document.getElementById('targetPhoneWrap'),
  urgentHistory: document.getElementById('urgentHistory'),
  exampleButtons: document.querySelectorAll('.example-btn'),
  urgentOverlay: document.getElementById('urgentOverlay'),
  urgentOverlayText: document.getElementById('urgentOverlayText'),
  urgentOverlayMeta: document.getElementById('urgentOverlayMeta'),
  closeOverlay: document.getElementById('closeOverlay'),
};

const storageKey = 'chat_api_token';
let token = localStorage.getItem(storageKey);
let me = null;
let seenUrgentIds = new Set();

const formatTime = (iso) => new Date(iso).toLocaleString('uk-UA');

const showTab = (tab) => {
  ui.tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  ui.chatSection.classList.toggle('hidden', tab !== 'chat');
  ui.urgentSection.classList.toggle('hidden', tab !== 'urgent');
};

const api = async (url, method = 'GET', body) => {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'API error');
  return payload;
};

const renderUsers = (users) => {
  ui.onlineUsers.innerHTML = '';
  users.forEach((user) => {
    const el = document.createElement('div');
    el.className = `user-pill ${user.phone === me?.phone ? 'me' : ''}`;
    el.textContent = `${user.name} (${user.phone})`;
    ui.onlineUsers.append(el);
  });
};

const renderMessages = (messages) => {
  ui.messages.innerHTML = '';
  messages.forEach((m) => {
    const isMine = m.senderPhone === me?.phone;
    const el = document.createElement('article');
    el.className = `message ${isMine ? 'mine' : ''}`;
    el.innerHTML = `
      <div>${m.text}</div>
      <div class="meta">${m.senderName} (${m.senderPhone}) • ${formatTime(m.createdAt)}</div>
    `;
    ui.messages.append(el);
  });
  ui.messages.scrollTop = ui.messages.scrollHeight;
};

const renderUrgent = (items) => {
  ui.urgentHistory.innerHTML = '';
  items
    .slice()
    .reverse()
    .forEach((u) => {
      const modeText = u.mode === 'global' ? 'ЗАГАЛЬНЕ' : `ПЕРСОНАЛЬНЕ → ${u.targetPhone}`;
      const el = document.createElement('article');
      el.className = `urgent-item ${u.mode}`;
      el.innerHTML = `
        <strong>${modeText}</strong>
        <div>${u.text}</div>
        <div class="meta">${u.senderName} • ${formatTime(u.createdAt)}</div>
      `;
      ui.urgentHistory.append(el);
    });

  const fresh = items.filter((item) => !seenUrgentIds.has(item.id));
  fresh.forEach((item) => {
    seenUrgentIds.add(item.id);
  });

  if (fresh.length) {
    const latest = fresh[fresh.length - 1];
    ui.urgentOverlayText.textContent = latest.text;
    ui.urgentOverlayMeta.textContent = `${latest.senderName} • ${latest.mode === 'global' ? 'загальне' : `персональне для ${latest.targetPhone}`}`;
    ui.urgentOverlay.classList.remove('hidden');
  }
};

const applyLoggedInUI = () => {
  ui.registrationSection.classList.add('hidden');
  ui.profileSection.classList.remove('hidden');
  ui.tabs.classList.remove('hidden');
  showTab('chat');
  ui.myProfile.textContent = `${me.name} (${me.phone})`;
};

const syncState = async () => {
  if (!token) return;

  try {
    const state = await api(`/api/state?token=${encodeURIComponent(token)}`);
    me = state.me;
    applyLoggedInUI();
    renderUsers(state.users);
    renderMessages(state.messages);
    renderUrgent(state.urgent);
  } catch {
    localStorage.removeItem(storageKey);
    token = null;
  }
};

ui.registrationForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const data = new FormData(ui.registrationForm);
  const payload = await api('/api/register', 'POST', {
    name: String(data.get('name')).trim(),
    phone: String(data.get('phone')).trim(),
  });

  token = payload.token;
  me = payload.profile;
  localStorage.setItem(storageKey, token);

  applyLoggedInUI();
  await syncState();
});

ui.messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const data = new FormData(ui.messageForm);
  const text = String(data.get('message')).trim();
  if (!text) return;

  await api('/api/chat/send', 'POST', { token, text });
  ui.messageForm.reset();
  await syncState();
});

ui.urgentMode.addEventListener('change', () => {
  ui.targetPhoneWrap.classList.toggle('hidden', ui.urgentMode.value !== 'personal');
});

ui.urgentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(ui.urgentForm);

  const mode = String(data.get('mode'));
  const text = String(data.get('urgentText')).trim();
  const targetPhone = String(data.get('targetPhone') || '').trim();

  if (!text) return;
  if (mode === 'personal' && !targetPhone) {
    alert('Для персонального срочного повідомлення вкажіть телефон отримувача.');
    return;
  }

  await api('/api/urgent/send', 'POST', { token, mode, text, targetPhone });
  ui.urgentForm.reset();
  ui.targetPhoneWrap.classList.add('hidden');
  await syncState();
});

ui.exampleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    ui.urgentForm.elements.urgentText.value = button.dataset.example;
  });
});

ui.tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

ui.callBtn.addEventListener('click', () => {
  if (!me) return;
  alert(`📞 Імітація дзвінка від ${me.name} (${me.phone})`);
});

ui.closeOverlay.addEventListener('click', () => {
  ui.urgentOverlay.classList.add('hidden');
});

if (token) syncState();
setInterval(syncState, 1500);
