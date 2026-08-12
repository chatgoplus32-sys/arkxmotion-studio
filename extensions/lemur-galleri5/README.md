# Galleri5 Token Capture — Lemur Browser Extension

Auto-capture Galleri5 auth tokens from `aistudio.galleri5.com` for ARKx Motion Studio.

## Features

- **Auto-capture** — Intercepts Bearer tokens from G5 AI Studio API requests
- **Firebase refresh** — Auto-refreshes expired Firebase ID tokens
- **Copy to clipboard** — One-click copy JWT token
- **Send to ARKx** — Opens ARKx Motion Studio with token pre-filled
- **Token management** — Shows email, expiry, capture time

## Install (Lemur Browser)

1. Open Lemur Browser
2. Go to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `extensions/lemur-galleri5` folder
6. Pin the extension to toolbar

## Install (Chrome / Edge / Any Chromium)

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extensions/lemur-galleri5` folder

## Usage

1. Login to [aistudio.galleri5.com](https://aistudio.galleri5.com)
2. The extension auto-captures your auth token
3. Click the extension icon to see captured tokens
4. Click **Copy JWT** to copy the token
5. Go to ARKx Motion Studio → Providers → G5 AI Studio
6. Paste the token and click Check

## How It Works

The extension uses:
- `webRequest.onBeforeSendHeaders` to intercept Authorization headers
- Content script to intercept `fetch()` and `XMLHttpRequest` calls
- Firebase REST API to refresh expired tokens
- Chrome storage to persist captured tokens

## File Structure

```
lemur-galleri5/
├── manifest.json      # Extension manifest (MV3)
├── background.js      # Service worker — token interception
├── content.js         # Content script — page-level capture
├── popup.html         # Popup UI
├── popup.js           # Popup logic
├── icons/
│   ├── icon.svg       # Source icon
│   ├── icon16.png     # 16x16
│   ├── icon48.png     # 48x48
│   └── icon128.png    # 128x128
└── README.md
```

## Notes

- Tokens are stored locally in Chrome storage (never sent anywhere except ARKx)
- Max 5 tokens stored (deduped by user ID)
- Expired tokens are marked with red badge
- Extension works with any Chromium-based browser (Lemur, Chrome, Edge, Brave, Vivaldi)
