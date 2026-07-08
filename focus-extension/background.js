// Focus Barrier — Background Service Worker

const DEFAULT_SETTINGS = {
  blockedSites: [],
  workHours: {
    mon: { start: '09:00', end: '17:00', enabled: true },
    tue: { start: '09:00', end: '17:00', enabled: true },
    wed: { start: '09:00', end: '17:00', enabled: true },
    thu: { start: '09:00', end: '17:00', enabled: true },
    fri: { start: '09:00', end: '17:00', enabled: true },
    sat: { start: '09:00', end: '17:00', enabled: false },
    sun: { start: '09:00', end: '17:00', enabled: false },
  },
  timerDurations: { working: 10, nonWorking: 30 },
  accessDurations: { working: 30, nonWorking: 60 },
  tempAccess: [],
  tempRuleIdCounter: 1000, // Start IDs at 1000+ to avoid collision with block rules
};

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// Initialize defaults on install
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const needsInit = Object.keys(DEFAULT_SETTINGS).some(key => !(key in data));
  if (needsInit) {
    await chrome.storage.local.set(DEFAULT_SETTINGS);
  }
  await rebuildBlockRules();
  await cleanupExpiredAccess();
  chrome.alarms.create('cleanup', { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'cleanup') {
    await cleanupExpiredAccess();
  }
});

// Rebuild block rules whenever storage changes
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.blockedSites || changes.tempAccess) {
    await rebuildBlockRules();
  }
});

async function getSettings() {
  const data = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...data };
}

let isRebuilding = false;

async function rebuildBlockRules() {
  if (isRebuilding) return;
  isRebuilding = true;
  try {
    const settings = await getSettings();
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingIds = existingRules.map(r => r.id);

    // Deduplicate rules by id (keep last occurrence)
    const ruleMap = new Map();

    // Block rules for each site
    settings.blockedSites.forEach((site, index) => {
      const domain = site.domain.replace(/^www\./, '');
      const rule = {
        id: Math.floor(index + 1),
        priority: 1,
        action: {
          type: 'redirect',
          redirect: {
            url: `${chrome.runtime.getURL('blocked.html')}?target=${encodeURIComponent('https://' + domain + '/')}`,
          },
        },
        condition: {
          urlFilter: `||${domain}`,
          resourceTypes: ['main_frame'],
        },
      };
      ruleMap.set(rule.id, rule);
    });

    // Temp allow rules (deduplicated by id)
    settings.tempAccess.forEach(access => {
      try {
        const url = new URL(access.url);
        const domain = url.hostname.replace(/^www\./, '');
        const ruleId = Math.floor(access.ruleId);
        if (!Number.isInteger(ruleId) || ruleId <= 0) return;
        const rule = {
          id: ruleId,
          priority: 2,
          action: { type: 'allow' },
          condition: {
            urlFilter: `||${domain}`,
            resourceTypes: ['main_frame'],
          },
        };
        ruleMap.set(rule.id, rule);
      } catch (e) {
        // Invalid URL, skip
      }
    });

    const finalRules = Array.from(ruleMap.values());

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingIds,
      addRules: finalRules,
    });
  } finally {
    isRebuilding = false;
  }
}

async function cleanupExpiredAccess() {
  const settings = await getSettings();
  const now = Date.now();
  const valid = settings.tempAccess.filter(a => a.expiresAt > now);
  const expired = settings.tempAccess.filter(a => a.expiresAt <= now);

  if (expired.length > 0) {
    await chrome.storage.local.set({ tempAccess: valid });
    await rebuildBlockRules();
  }
}

// Handle messages from blocked.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REQUEST_ACCESS') {
    handleAccessRequest(message.url, message.durationMinutes)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }
});

async function handleAccessRequest(url, durationMinutes) {
  const settings = await getSettings();
  const ruleId = Math.floor(settings.tempRuleIdCounter);
  const newCounter = settings.tempRuleIdCounter + 1;
  const expiresAt = Date.now() + durationMinutes * 60 * 1000;

  const newAccess = {
    url,
    expiresAt,
    ruleId,
  };

  const updated = [...settings.tempAccess, newAccess];
  await chrome.storage.local.set({ tempAccess: updated, tempRuleIdCounter: newCounter });
  await rebuildBlockRules();

  // Set timeout to clean up (best-effort; storage is source of truth)
  setTimeout(async () => {
    const current = await getSettings();
    const stillValid = current.tempAccess.filter(a => a.ruleId !== ruleId);
    if (stillValid.length !== current.tempAccess.length) {
      await chrome.storage.local.set({ tempAccess: stillValid });
      await rebuildBlockRules();
    }
  }, durationMinutes * 60 * 1000);
}
