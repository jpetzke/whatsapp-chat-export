# WhatsApp Chat Export

Minimal Chrome/Brave extension (Manifest V3) that exports the last N messages of an open WhatsApp Web chat as compact, LLM-friendly Markdown.

Includes per message: date, time (HH:MM), sender, quoted message being replied to, reactions, media hints (image, video, voice note, document, sticker, location, contact, forwarded, edited, deleted) and links.

```
## 2026-07-28
[12:49] Alice: Back from the festival
[12:49] Bob:
> Alice: Back from the festival
Glad you survived
Reaktionen: 👍
```

## Install
1. `brave://extensions` (or `chrome://extensions`) → enable Developer mode
2. "Load unpacked" → select this folder

## Use
Open a chat on web.whatsapp.com → click the extension → set N → "Exportieren". The chat is scrolled up automatically (WhatsApp virtualizes the message list) and a `.txt` file is downloaded.

"Debug-Dump" saves the chat's DOM structure with all letters masked, for fixing selectors when WhatsApp changes its markup.

## Limitations
- Scrapes the DOM, so it breaks when WhatsApp Web changes its markup.
- WhatsApp Web only shows HH:MM, no seconds.
- Reaction senders are not exported (not in the DOM without clicking).
- Everything runs locally; no data leaves the browser.
