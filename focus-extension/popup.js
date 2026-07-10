// Focus Barrier — Minimal Popup Logic

function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

function showStatus(msg, type) {
  const el = document.getElementById('block-status');
  el.textContent = msg;
  el.className = `status status-${type}`;
  setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 3000);
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    document.getElementById('current-domain').textContent = 'No active tab';
    return;
  }

  const domain = extractDomain(tab.url);
  if (!domain) {
    document.getElementById('current-domain').textContent = 'Invalid URL';
    return;
  }

  document.getElementById('current-domain').textContent = domain;

  const settings = await chrome.storage.local.get(['blockedSites']);
  const isBlocked = settings.blockedSites.some(s => s.domain === domain);

  const blockBtn = document.getElementById('block-btn');

  if (isBlocked) {
    blockBtn.style.display = 'none';
    showStatus('Already blocked', 'success');
  } else {
    blockBtn.addEventListener('click', async () => {
      const updated = [...(settings.blockedSites || []), { domain, addedAt: new Date().toISOString() }];
      await chrome.storage.local.set({ blockedSites: updated });
      showStatus('Blocked!', 'success');
      blockBtn.style.display = 'none';
    });
  }
}

document.getElementById('settings-link').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'settings.html' });
});

init();
