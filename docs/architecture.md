# Focus Barrier — Chrome Extension Architecture

## 1. Product Requirements Summary

| Requirement | Detail |
|-------------|--------|
| **Core behavior** | Block configured distracting sites. User must wait a timer + type a reason (min 30 chars) before access is granted. |
| **Working hours** | Configurable per-day schedule. Default: Mon–Fri 09:00–17:00. Timezone = user's local system time. |
| **Timer durations** | Working hours: 10 minutes. Non-working hours: 30 seconds. Both configurable. |
| **Access duration** | Working hours: 30 minutes. Non-working hours: 1 hour. Both configurable. |
| **Timer reset** | Closing the tab resets the timer. Re-opening a blocked site starts the timer from the beginning. |
| **Reason logging** | V1: not persisted. Textbox is a cognitive friction / guilt-trip device only. |
| **Emergency bypass** | None. Friction is always the point. |
| **Site management** | Add via toolbar popup (current tab or manual URL). Remove via popup settings. All subdomains blocked automatically. |
| **No persistence of reasons** | Reasons are not stored, logged, or synced. |

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Browser                        │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────┐  │
│  │  Popup UI   │    │ Blocked Page │    │ Background │  │
│  │ (popup.html │    │ (blocked.html│    │  Service   │  │
│  │  + popup.js)│    │  + blocked.js)│   │  Worker    │  │
│  └──────┬──────┘    └──────┬───────┘    │(background │  │
│         │                  │             │  .js)      │  │
│         │ chrome.storage   │             └─────┬──────┘  │
│         │   .local         │                   │        │
│         └────────┬─────────┘                   │        │
│                  │                             │        │
│  ┌───────────────▼─────────────────────────────▼──────┐  │
│  │              chrome.storage.local                   │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │ blockedSites: [{domain, addedAt}]            │  │  │
│  │  │ workHours: {mon: {start, end}, ...}          │  │  │
│  │  │ timerDurations: {working: 10, nonWorking: 30}│  │  │
│  │  │ accessDurations: {working: 30, nonWorking: 60}│ │  │
│  │  │ tempAccess: [{url, expiresAt}]               │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │         declarativeNetRequest API                   │  │
│  │  • Dynamic rules: block configured domains          │  │
│  │  • Dynamic rules: redirect to blocked.html          │  │
│  │  • Dynamic rules: temporary allow (tempAccess)      │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Component Design

### 3.1 manifest.json (Manifest V3)

```json
{
  "manifest_version": 3,
  "name": "Focus Barrier",
  "version": "1.0",
  "permissions": ["storage", "declarativeNetRequest", "tabs"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" },
  "declarative_net_request": { "rule_resources": [] }
}
```

**Key decisions:**
- **Manifest V3** — required for new Chrome extensions; service worker replaces background page.
- **declarativeNetRequest** — the MV3-approved way to block/redirect requests. More performant and battery-friendly than `webRequest` blocking.
- **No content scripts** — we don't need them. Blocking is done at the network request layer via declarativeNetRequest. The blocked page is served via redirect.

### 3.2 background.js (Service Worker)

**Responsibilities:**
1. **Initialize rules on install/startup** — read `blockedSites` from storage, build declarativeNetRequest dynamic rules.
2. **Manage dynamic rules** — add/remove block rules and temporary allow rules.
3. **Clean up expired tempAccess** — periodically scan `tempAccess` in storage and remove expired allow rules.
4. **Handle tab updates** — detect when user navigates to a blocked site (optional, for analytics).

**Rule structure:**

Block rule (for each blocked domain):
```json
{
  "id": 1,
  "priority": 1,
  "action": {
    "type": "redirect",
    "redirect": {
      "url": "chrome-extension://[EXTENSION_ID]/blocked.html?target=${url}"
    }
  },
  "condition": {
    "urlFilter": "||example.com",
    "resourceTypes": ["main_frame"]
  }
}
```

Temporary allow rule (higher priority):
```json
{
  "id": 1001,
  "priority": 2,
  "action": { "type": "allow" },
  "condition": {
    "urlFilter": "||example.com",
    "resourceTypes": ["main_frame"]
  }
}
```

**Why redirect instead of block?**
- A plain block would show Chrome's default "blocked" page with no way to interact.
- Redirecting to `blocked.html` gives us a controlled UI where the user can see the timer, type a reason, and then be redirected back.

### 3.3 blocked.html + blocked.js

**The access gate UI.**

**Flow:**
1. Parse `target` URL from query string.
2. Determine if current time is within working hours.
3. Look up timer duration and access duration from storage.
4. Show countdown timer (10 min or 30 sec).
5. Disable textbox during countdown.
6. When countdown reaches zero, enable textbox.
7. User types reason (min 30 chars).
8. On submit:
   - Validate length.
   - Call `chrome.runtime.sendMessage` to background to create temp access.
   - Background adds a high-priority allow rule + stores `tempAccess` entry.
   - Redirect user to original URL.

**Timer reset behavior:**
- If user closes the tab mid-countdown and re-opens the blocked site, the timer starts from zero again.
- This is naturally handled because `blocked.html` is a fresh page load each time.

**Access expiry:**
- The temporary allow rule has a fixed duration (30 min or 1 hour).
- Background service worker sets a `setTimeout` to remove the rule when it expires.
- If the service worker is terminated before the timeout, the `tempAccess` entry in storage has `expiresAt`. On next startup, background cleans up any expired entries.

### 3.4 popup.html + popup.js

**The toolbar popup for site management and settings.**

**Sections:**
1. **Add Site**
   - Button: "Add current tab" — reads active tab URL, extracts domain, adds to block list.
   - Input field + button: "Add custom URL" — user types a URL, we extract the domain.
   - Validation: must be a valid URL, must not already be in the list.
   - On add: update storage, rebuild declarativeNetRequest rules.

2. **Blocked Sites List**
   - Shows all configured domains.
   - Each row: domain name + "Remove" button.
   - On remove: update storage, rebuild rules.

3. **Settings**
   - Work hours configuration per day (Mon–Sun).
   - Each day: start time (HH:MM), end time (HH:MM), enabled toggle.
   - Timer durations: working hours (minutes), non-working hours (seconds).
   - Access durations: working hours (minutes), non-working hours (minutes).
   - "Save" button persists to storage.

**Subdomain handling:**
- When user adds `youtube.com`, we store `youtube.com`.
- The declarativeNetRequest rule uses `||youtube.com` which matches `youtube.com`, `www.youtube.com`, `music.youtube.com`, etc.
- No need to enumerate subdomains.

### 3.5 Storage Schema (chrome.storage.local)

```javascript
{
  blockedSites: [
    { domain: "youtube.com", addedAt: "2024-01-15T10:00:00Z" }
  ],
  workHours: {
    mon: { start: "09:00", end: "17:00", enabled: true },
    tue: { start: "09:00", end: "17:00", enabled: true },
    wed: { start: "09:00", end: "17:00", enabled: true },
    thu: { start: "09:00", end: "17:00", enabled: true },
    fri: { start: "09:00", end: "17:00", enabled: true },
    sat: { start: "09:00", end: "17:00", enabled: false },
    sun: { start: "09:00", end: "17:00", enabled: false }
  },
  timerDurations: {
    working: 10,    // minutes
    nonWorking: 30  // seconds
  },
  accessDurations: {
    working: 30,    // minutes
    nonWorking: 60  // minutes
  },
  tempAccess: [
    { url: "https://www.youtube.com/watch?v=abc", expiresAt: 1704067200000 }
  ]
}
```

---

## 4. User Flows

### 4.1 First Install / Setup

1. User installs extension.
2. `background.js` runs `onInstalled` — initializes default settings in storage if not present.
3. User clicks extension icon — sees popup with default blocked sites list (empty) and default settings.
4. User adds sites via popup.

### 4.2 Normal Block Flow

1. User types `youtube.com` in address bar.
2. declarativeNetRequest intercepts the request.
3. Browser redirects to `blocked.html?target=https://www.youtube.com/`.
4. `blocked.js` reads target URL, checks current time against `workHours`.
5. Determines it's working hours → shows 10-minute countdown.
6. User watches countdown. If they close the tab, timer is lost.
7. Countdown reaches zero → textbox enables.
8. User types reason (min 30 chars) and submits.
9. `blocked.js` sends message to `background.js` to create temp access.
10. `background.js`:
    - Adds high-priority allow rule for `youtube.com`.
    - Stores `tempAccess` entry with `expiresAt = now + 30 minutes`.
    - Sets `setTimeout` to remove rule after 30 minutes.
11. `blocked.js` redirects user to original YouTube URL.
12. User browses YouTube for 30 minutes.
13. After 30 minutes, allow rule is removed. Next navigation to YouTube triggers the block again.

### 4.3 Non-Working Hours Flow

Same as above, but:
- Timer is 30 seconds.
- Access duration is 1 hour.

### 4.4 Adding a Site

1. User is on `reddit.com`.
2. Clicks extension icon.
3. Popup shows "Add current tab" button pre-filled with `reddit.com`.
4. User clicks it.
5. `reddit.com` is added to `blockedSites`.
6. `background.js` rebuilds declarativeNetRequest rules.
7. Next navigation to `reddit.com` (or any subdomain) is blocked.

---

## 5. Technical Decisions & Trade-offs

| Decision | Rationale | Trade-off |
|----------|-----------|-----------|
| **Manifest V3 + declarativeNetRequest** | Future-proof, better performance, required by Chrome Web Store. | More complex than `webRequest` blocking; redirect URLs have limitations. |
| **Redirect to local page instead of content script injection** | Cleaner separation; works even on sites that block script injection. | User sees a page load flash; slightly slower than inline overlay. |
| **Service worker for rule management** | MV3 requirement; keeps logic centralized. | Service worker can be terminated; need storage-backed state for recovery. |
| **No reason persistence (V1)** | Keeps V1 simple; reasons are purely for cognitive friction. | User can't review past reasons. Easy to add later. |
| **Subdomain blocking via `||domain` syntax** | declarativeNetRequest handles this natively. | None — this is the correct approach. |
| **Timer reset on tab close** | Matches user requirement; prevents "cheating" by keeping a tab open. | User can't pause and resume; must complete timer in one sitting. |
| **No emergency bypass** | Friction is the core mechanism. | User can be stuck if they genuinely need access. Acceptable for V1 personal use. |

---

## 6. Edge Cases & Implementation Gotchas

### 6.1 Service Worker Lifecycle
- Chrome can terminate the service worker at any time when it's idle.
- **Mitigation:** All state lives in `chrome.storage.local`. On `onStartup`, background scans `tempAccess` and removes expired entries. The `setTimeout` for rule cleanup is best-effort; storage is the source of truth.

### 6.2 Extension ID in Redirect URL
- `chrome-extension://[EXTENSION_ID]/blocked.html` requires knowing the extension ID at runtime.
- **Mitigation:** Use `chrome.runtime.getURL('blocked.html')` to construct the URL dynamically in background.js when building rules.

### 6.3 Query Parameter Encoding
- The target URL may contain `&`, `=`, `?` etc.
- **Mitigation:** Use `encodeURIComponent()` when constructing the redirect URL, and `decodeURIComponent()` in `blocked.js`.

### 6.4 Timezone Handling
- User's local timezone is used automatically by `new Date()` in the browser.
- **Mitigation:** No explicit timezone handling needed — JavaScript `Date` object uses the system timezone.

### 6.5 Working Hours Edge Cases
- What if start > end (e.g., night shift: 22:00–06:00)?
- **V1 decision:** Don't support overnight shifts. Start must be < end. Can be enhanced later.

### 6.6 Multiple Tabs
- User might have multiple blocked tabs open simultaneously.
- Each tab runs its own `blocked.html` instance with its own timer.
- **Mitigation:** This is fine — each tab is independent. The temp access rule is global, so once one tab completes the flow, all blocked tabs for that domain will be allowed.

### 6.7 Rule ID Management
- declarativeNetRequest rules are identified by integer IDs.
- Block rules: IDs 1–N (based on number of blocked sites).
- Temp allow rules: IDs 1000+ (to avoid collision).
- **Mitigation:** Use a counter or timestamp-based IDs for temp rules.

### 6.8 Popup State Sync
- If user adds a site in one popup instance, another open popup won't auto-refresh.
- **Mitigation:** Use `chrome.storage.onChanged` listener in popup.js to refresh the UI when storage changes.

### 6.9 URL Extraction
- User might paste `https://www.youtube.com/watch?v=abc` — we need to extract `youtube.com`.
- **Mitigation:** Use `new URL(url).hostname`, then strip `www.` prefix if present.

---

## 7. File Structure

```
focus-extension/
├── manifest.json
├── background.js
├── popup.html
├── popup.js
├── popup.css
├── blocked.html
├── blocked.js
├── blocked.css
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 8. Implementation Sequence

1. **manifest.json** — extension metadata and permissions.
2. **background.js** — storage initialization, rule management, temp access lifecycle.
3. **blocked.html + blocked.js + blocked.css** — the core access gate UI.
4. **popup.html + popup.js + popup.css** — site management and settings.
5. **Icons** — simple placeholder icons for the toolbar.

---

