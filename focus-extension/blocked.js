// Focus Barrier — Blocked Page Logic

const MIN_REASON_LENGTH = 30;

function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

function isWorkingHours(workHours) {
  const now = new Date();
  const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
  const schedule = workHours[dayKey];

  if (!schedule || !schedule.enabled) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = schedule.start.split(':').map(Number);
  const [endH, endM] = schedule.end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function init() {
  const targetUrl = getQueryParam('target');
  if (!targetUrl) {
    document.body.innerHTML = '<h1>Focus Barrier</h1><p>No target URL specified.</p>';
    return;
  }

  document.getElementById('target-info').textContent = `Target: ${decodeURIComponent(targetUrl)}`;

  const settings = await chrome.storage.local.get([
    'workHours',
    'timerDurations',
    'accessDurations',
  ]);

  const workHours = settings.workHours || {};
  const timerDurations = settings.timerDurations || { working: 10, nonWorking: 30 };
  const accessDurations = settings.accessDurations || { working: 30, nonWorking: 60 };

  const working = isWorkingHours(workHours);
  const timerSeconds = working ? timerDurations.working * 60 : timerDurations.nonWorking;
  const accessMinutes = working ? accessDurations.working : accessDurations.nonWorking;

  const timerEl = document.getElementById('timer');
  const timerLabel = document.getElementById('timer-label');
  const reasonSection = document.getElementById('reason-section');
  const reasonInput = document.getElementById('reason');
  const charCount = document.getElementById('char-count');
  const submitBtn = document.getElementById('submit-btn');
  const status = document.getElementById('status');

  let remaining = timerSeconds;

  function updateTimer() {
    timerEl.textContent = formatTime(remaining);
    if (remaining <= 0) {
      clearInterval(interval);
      timerLabel.textContent = 'Timer complete. Please state your reason:';
      reasonSection.style.display = 'block';
      reasonInput.focus();
    }
    remaining--;
  }

  updateTimer();
  const interval = setInterval(updateTimer, 1000);

  reasonInput.addEventListener('input', () => {
    const len = reasonInput.value.length;
    charCount.textContent = `${len} / ${MIN_REASON_LENGTH} characters`;
    submitBtn.disabled = len < MIN_REASON_LENGTH;
  });

  submitBtn.addEventListener('click', async () => {
    const reason = reasonInput.value.trim();
    if (reason.length < MIN_REASON_LENGTH) return;

    status.textContent = 'Granting access...';
    status.classList.remove('error');
    submitBtn.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'REQUEST_ACCESS',
        url: decodeURIComponent(targetUrl),
        durationMinutes: accessMinutes,
      });

      if (response.success) {
        status.textContent = 'Access granted! Redirecting...';
        setTimeout(() => {
          window.location.href = decodeURIComponent(targetUrl);
        }, 500);
      } else {
        status.textContent = `Error: ${response.error}`;
        status.classList.add('error');
        submitBtn.disabled = false;
      }
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.classList.add('error');
      submitBtn.disabled = false;
    }
  });
}

init();
