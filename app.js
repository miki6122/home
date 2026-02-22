const storageKeys = {
  profile: 'chat_profile',
  messages: 'chat_messages',
  urgent: 'chat_urgent_messages',
};

const registrationSection = document.getElementById('registrationSection');
const chatSection = document.getElementById('chatSection');
const urgentSection = document.getElementById('urgentSection');
const registrationForm = document.getElementById('registrationForm');
const messageForm = document.getElementById('messageForm');
const urgentForm = document.getElementById('urgentForm');
const messagesContainer = document.getElementById('messages');
const urgentHistory = document.getElementById('urgentHistory');
const userCard = document.getElementById('userCard');
const resetProfileBtn = document.getElementById('resetProfile');
const callBtn = document.getElementById('callBtn');
const urgentOverlay = document.getElementById('urgentOverlay');
const urgentOverlayText = document.getElementById('urgentOverlayText');
const closeOverlayBtn = document.getElementById('closeOverlay');
const tabButtons = document.querySelectorAll('.tab-btn');

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

let profile = read(storageKeys.profile, null);
let messages = read(storageKeys.messages, []);
let urgentMessages = read(storageKeys.urgent, []);

const formatTime = (isoDate) => new Date(isoDate).toLocaleString('uk-UA');

function renderProfile() {
  if (!profile) {
    userCard.innerHTML = 'Профіль не створено';
    registrationSection.classList.remove('hidden');
    chatSection.classList.add('hidden');
    urgentSection.classList.add('hidden');
    return;
  }

  userCard.innerHTML = `<strong>${profile.name}</strong><br>${profile.phone}`;
  registrationSection.classList.add('hidden');
  showTab('chat');
}

function renderMessages() {
  messagesContainer.innerHTML = '';

  if (!messages.length) {
    messagesContainer.innerHTML = '<p>Ще немає повідомлень.</p>';
    return;
  }

  messages.forEach((msg) => {
    const item = document.createElement('article');
    item.className = 'message';
    item.innerHTML = `
      <div>${msg.text}</div>
      <div class="message-meta">${msg.sender} • ${formatTime(msg.createdAt)}</div>
    `;
    messagesContainer.append(item);
  });

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function renderUrgentHistory() {
  urgentHistory.innerHTML = '';

  if (!urgentMessages.length) {
    urgentHistory.innerHTML = '<p>Немає срочних повідомлень.</p>';
    return;
  }

  urgentMessages
    .slice()
    .reverse()
    .forEach((item) => {
      const box = document.createElement('div');
      box.className = 'urgent-item';
      box.innerHTML = `<strong>${formatTime(item.createdAt)}</strong><br>${item.text}`;
      urgentHistory.append(box);
    });
}

function showUrgentOverlay(text) {
  urgentOverlayText.textContent = text;
  urgentOverlay.classList.remove('hidden');
}

function showTab(tab) {
  tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  chatSection.classList.toggle('hidden', tab !== 'chat');
  urgentSection.classList.toggle('hidden', tab !== 'urgent');
}

registrationForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(registrationForm);

  profile = {
    name: String(formData.get('name')).trim(),
    phone: String(formData.get('phone')).trim(),
  };

  write(storageKeys.profile, profile);
  renderProfile();
});

resetProfileBtn.addEventListener('click', () => {
  localStorage.removeItem(storageKeys.profile);
  profile = null;
  renderProfile();
});

messageForm.addEventListener('submit', (event) => {
  event.preventDefault();

  if (!profile) return;

  const formData = new FormData(messageForm);
  const text = String(formData.get('message')).trim();

  if (!text) return;

  messages.push({
    sender: profile.name,
    text,
    createdAt: new Date().toISOString(),
  });

  write(storageKeys.messages, messages);
  messageForm.reset();
  renderMessages();
});

urgentForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const formData = new FormData(urgentForm);
  const urgentText = String(formData.get('urgentText')).trim();

  if (!urgentText) return;

  const payload = {
    text: urgentText,
    createdAt: new Date().toISOString(),
  };

  urgentMessages.push(payload);
  write(storageKeys.urgent, urgentMessages);

  urgentForm.reset();
  renderUrgentHistory();
  showUrgentOverlay(payload.text);
});

closeOverlayBtn.addEventListener('click', () => {
  urgentOverlay.classList.add('hidden');
});

callBtn.addEventListener('click', () => {
  if (!profile) return;
  alert(`📞 Ви телефонуєте як ${profile.name} (${profile.phone})`);
});

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!profile) return;
    showTab(btn.dataset.tab);
  });
});

renderProfile();
renderMessages();
renderUrgentHistory();
