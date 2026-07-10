// Focus Barrier — Settings Page Logic

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'blockedSites',
    'workHours',
    'timerDurations',
    'accessDurations',
  ]);

  renderSiteList(settings.blockedSites || []);
  renderWorkHoursSettings(settings.workHours || {});
  document.getElementById('timer-working').value = (settings.timerDurations || {}).working || 10;
  document.getElementById('timer-nonworking').value = (settings.timerDurations || {}).nonWorking || 30;
  document.getElementById('access-working').value = (settings.accessDurations || {}).working || 30;
  document.getElementById('access-nonworking').value = (settings.accessDurations || {}).nonWorking || 60;
}

function renderSiteList(sites) {
  const list = document.getElementById('site-list');
  const emptyMsg = document.getElementById('empty-msg');
  list.innerHTML = '';

  if (sites.length === 0) {
    emptyMsg.style.display = 'block';
    return;
  }

  emptyMsg.style.display = 'none';
  sites.forEach(site => {
    const li = document.createElement('li');
    li.className = 'site-item';
    li.innerHTML = `
      <span class="site-domain">${site.domain}</span>
      <button class="btn btn-danger btn-sm remove-btn" data-domain="${site.domain}">Remove</button>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      const settings = await chrome.storage.local.get(['blockedSites']);
      const updated = settings.blockedSites.filter(s => s.domain !== domain);
      await chrome.storage.local.set({ blockedSites: updated });
      renderSiteList(updated);
    });
  });
}

function renderWorkHoursSettings(workHours) {
  const container = document.getElementById('work-hours-settings');
  container.innerHTML = '';

  DAY_KEYS.forEach((day, i) => {
    const schedule = workHours[day] || { start: '09:00', end: '17:00', enabled: false };
    const div = document.createElement('div');
    div.className = 'day-row';
    div.innerHTML = `
      <label class="day-label">
        <input type="checkbox" class="day-enabled" data-day="${day}" ${schedule.enabled ? 'checked' : ''}>
        ${DAY_LABELS[i]}
      </label>
      <input type="time" class="day-start" data-day="${day}" value="${schedule.start}">
      <span>to</span>
      <input type="time" class="day-end" data-day="${day}" value="${schedule.end}">
    `;
    container.appendChild(div);
  });
}

document.getElementById('add-custom').addEventListener('click', async () => {
  const input = document.getElementById('custom-url');
  const domain = extractDomain(input.value.trim());
  if (!domain) {
    showStatus('Please enter a valid URL', 'error');
    return;
  }

  const settings = await chrome.storage.local.get(['blockedSites']);
  if (settings.blockedSites.some(s => s.domain === domain)) {
    showStatus('Site already blocked', 'error');
    return;
  }

  const updated = [...settings.blockedSites, { domain, addedAt: new Date().toISOString() }];
  await chrome.storage.local.set({ blockedSites: updated });
  renderSiteList(updated);
  input.value = '';
  showStatus('Site added!', 'success');
});

document.getElementById('save-settings').addEventListener('click', async () => {
  const workHours = {};
  DAY_KEYS.forEach(day => {
    const enabled = document.querySelector(`.day-enabled[data-day="${day}"]`).checked;
    const start = document.querySelector(`.day-start[data-day="${day}"]`).value;
    const end = document.querySelector(`.day-end[data-day="${day}"]`).value;
    workHours[day] = { start, end, enabled };
  });

  const timerDurations = {
    working: parseInt(document.getElementById('timer-working').value) || 10,
    nonWorking: parseInt(document.getElementById('timer-nonworking').value) || 30,
  };

  const accessDurations = {
    working: parseInt(document.getElementById('access-working').value) || 30,
    nonWorking: parseInt(document.getElementById('access-nonworking').value) || 60,
  };

  await chrome.storage.local.set({ workHours, timerDurations, accessDurations });
  showStatus('Settings saved!', 'success');
});

function showStatus(msg, type) {
  const el = document.getElementById('add-status') || document.getElementById('save-status');
  el.textContent = msg;
  el.className = `status status-${type}`;
  setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 3000);
}

chrome.storage.onChanged.addListener(() => {
  loadSettings();
});

loadSettings();
