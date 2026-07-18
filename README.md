# Focus

A browser extension that helps you stay focused by adding a timer barrier before you can access distracting websites during your work hours.

[![Focus — Demo](https://img.youtube.com/vi/ECuFfQmjLHc/maxresdefault.jpg)](https://www.youtube.com/watch?v=ECuFfQmjLHc)

## Features

- **Quickly block distracting sites** directly from the popup
- **Minimal popup UI** — shows the current tab's domain with a single Block button; if the site is already blocked, it simply says "Already blocked"
- **Settings page** for full configuration
- **Configurable work hours** — set per-day start/end times
- **Adjustable timer durations** — different timers for working and non-working hours
- **Access durations** — control how long you can stay on a site after the timer
- **Temporary access** — request timed access via the blocked page

## How It Works

When you try to visit a blocked site, Focus Barrier shows an interstitial page with a countdown timer. After the timer completes, you must type a reason before being granted temporary access.

## Installation

Load the `focus-extension` folder as an unpacked extension in Chrome:
1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `focus-extension` directory

## Project Structure

```
focus-extension/
├── manifest.json       # Manifest V3 configuration
├── popup.html/js/css   # Minimal popup UI
├── settings.html/js/css # Full settings page
├── blocked.html/js/css  # Interstitial blocked page
├── background.js       # Service worker (rule management, alarms)
└── icons/              # Extension icons
```
