const status = (t) => (document.getElementById('status').textContent = t);

document.getElementById('go').onclick = async () => {
  const n = parseInt(document.getElementById('n').value, 10) || 100;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith('https://web.whatsapp.com')) return status('Not on web.whatsapp.com');
  status('Loading messages…');
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: exportChat,
      args: [n],
    });
    if (result.error) return status(result.error);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([result.md], { type: 'text/plain' }));
    a.download = `whatsapp_${result.chat.replace(/[^\w-]+/g, '_')}_${result.stamp.replace(/[: ]/g, '-')}.txt`;
    a.click();
    status(`Exported ${result.count} messages`);
  } catch (e) {
    status('Error: ' + e.message);
  }
};

// Runs inside the WhatsApp Web page.
async function exportChat(n) {
  const main = document.querySelector('#main');
  if (!main) return { error: 'No chat open' };
  const chat = main.querySelector('header span[dir="auto"]')?.textContent.trim() || 'Chat';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Text incl. emojis (WA renders emojis as <img alt="😀">)
  const textOf = (el) => {
    if (!el) return '';
    let s = '';
    el.childNodes.forEach((c) => {
      if (c.nodeType === 3) s += c.textContent;
      else if (c.tagName === 'IMG') s += c.alt || '';
      else if (c.tagName === 'BR') s += '\n';
      else s += textOf(c);
    });
    return s;
  };

  const parse = (row, m) => {
    const q = m.querySelector('[data-testid="quoted-message"]');
    const outsideQ = (e) => !q?.contains(e);
    const pre = m.querySelector('[data-pre-plain-text]')?.dataset.prePlainText || '';
    const pm = pre.match(/^\[(\d{1,2}:\d{2}(?:\s?[AP]M)?),\s*(.+?)\]\s*(.*?):\s*$/i);
    const meta = m.querySelector('[data-testid="msg-meta"]');
    const fromMe = !!m.querySelector('[data-icon="tail-out"]') || !!meta?.querySelector('[aria-label]');
    const time = pm?.[1] || textOf(meta).trim().match(/\d{1,2}:\d{2}(\s?[AP]M)?/i)?.[0] || '?';

    let quote = '';
    if (q) {
      const author = textOf(q.querySelector('[data-testid="author"], span[dir="auto"]')).trim();
      const qText = textOf(q.querySelector('.quoted-mention')).trim() || textOf(q).replace(author, '').trim();
      quote = `${author}: ${qText}`.replace(/\n/g, '\n> ');
    }

    const body = [...m.querySelectorAll('span[data-testid="selectable-text"], span.selectable-text')]
      .filter((e) => outsideQ(e) && !e.parentElement.closest('span.selectable-text'))
      .map((e) => textOf(e).trim()).filter(Boolean).join('\n');

    const has = (sel) => [...m.querySelectorAll(sel)].some(outsideQ);
    const media = [];
    if (has('[data-icon="recalled"]')) media.push('[Deleted message]');
    if (has('[data-icon*="forward"]')) media.push('[Forwarded]');
    if (has('[data-icon*="audio"], [data-icon*="ptt"], audio')) {
      const dur = [...m.querySelectorAll('span, div')].filter(outsideQ).map((e) => e.textContent.trim())
        .find((t) => /^\d{1,2}:\d{2}$/.test(t) && t !== time);
      media.push(`[Voice message${dur ? ' ' + dur : ''}]`);
    }
    if (has('video, [data-icon*="video"], [data-icon="media-play"]')) media.push('[Video]');
    if (has('[data-icon*="document"], [data-icon*="doc-"]')) {
      const name = [...m.querySelectorAll('[title]')].filter(outsideQ).map((e) => e.title).find(Boolean);
      media.push(`[Document${name ? ': ' + name : ''}]`);
    }
    if (has('[data-icon*="sticker"]') || /sticker/i.test(m.innerHTML)) media.push('[Sticker]');
    else if (has('img[src^="blob:"], img[src*="mmg.whatsapp.net"]')) media.push('[Image]');
    if (has('[data-icon*="location"]') || m.querySelector('a[href*="maps.google"]')) media.push('[Location]');
    if (has('[data-icon*="vcard"], [data-icon*="contact"]')) media.push('[Contact]');
    if ([...m.querySelectorAll('span')].some((e) => /^(Bearbeitet|Edited)$/i.test(e.textContent.trim()))) media.push('[Edited]');
    const links = [...m.querySelectorAll('a[href]')].filter(outsideQ).map((e) => e.href)
      .filter((h) => !body.includes(h) && !h.startsWith('javascript'));

    const rEl = row.querySelector('[aria-label*="reakt" i], [aria-label*="react" i]');
    const reactions = rEl ? (textOf(rEl).trim() || rEl.getAttribute('aria-label')) : '';

    return { date: pm?.[2] || '', time, sender: pm?.[3] || (fromMe ? 'Me' : chat), fromMe, quote, body, media, links, reactions };
  };

  // List is virtualized: scroll up step by step, collect rendered messages by data-id
  const data = new Map();
  let order = [];
  const harvest = () => {
    const ids = [];
    main.querySelectorAll('[role="row"]').forEach((row) => {
      const m = row.querySelector('[data-id]');
      if (!m) return;
      ids.push(m.dataset.id);
      if (!data.has(m.dataset.id) && !m.querySelector('[data-virtualized="true"]') && m.querySelector('[data-testid="msg-container"]'))
        data.set(m.dataset.id, parse(row, m));
    });
    const known = new Set(order);
    const k = ids.findIndex((id) => known.has(id));
    if (k === -1) order = order.length ? ids.concat(order) : ids;
    else order = ids.slice(0, k).filter((id) => !known.has(id)).concat(order, ids.slice(k).filter((id) => !known.has(id)));
  };

  const anyMsg = main.querySelector('[data-id]');
  if (!anyMsg) return { error: 'No messages found' };
  let scroller = anyMsg.parentElement;
  while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(scroller).overflowY)))
    scroller = scroller.parentElement;
  if (!scroller) return { error: 'Scroll container not found' };

  scroller.scrollTop = scroller.scrollHeight;
  await sleep(800);
  harvest();
  let stuck = 0;
  while (stuck < 6) {
    const lastN = order.slice(-n);
    if (lastN.length >= n && lastN.every((id) => data.has(id))) break;
    const before = scroller.scrollTop, count = order.length;
    scroller.scrollTop -= scroller.clientHeight * 0.7;
    await sleep(500);
    harvest();
    stuck = scroller.scrollTop === before && order.length === count ? stuck + 1 : 0;
    if (stuck) await sleep(1000); // waiting for older messages to load
  }
  scroller.scrollTop = scroller.scrollHeight;

  // Compact LLM-friendly output: one heading per day, "[HH:MM] Sender: text"
  const iso = (d) => { const m = d.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : d; };
  const me = [...data.values()].find((d) => d.fromMe && d.sender !== 'Me')?.sender || 'Me';
  const ids = order.slice(-n);
  let lastDate = '', curDate = null;
  const out = [];
  for (const id of ids) {
    const d = data.get(id);
    if (!d) { out.push('[Message not loaded]'); continue; }
    if (d.date) lastDate = iso(d.date);
    if (lastDate !== curDate) { out.push(`\n## ${lastDate}`); curDate = lastDate; }
    const text = [d.media.join(' '), d.body, ...d.links].filter(Boolean).join(d.body.includes('\n') ? '\n' : ' ');
    const quote = d.quote ? d.quote.replace(/^(Du|You):/, `${me}:`) : '';
    let msg = `[${d.time}] ${d.sender}:`;
    msg += quote ? `\n> ${quote}\n${text}` : text.includes('\n') ? `\n${text}` : ` ${text}`;
    if (d.reactions) msg += `\nReactions: ${d.reactions}`;
    out.push(msg.replace(/[ \t]+$/gm, ''));
  }

  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${now.toTimeString().slice(0, 8)}`;
  const md = `# WhatsApp chat: ${chat}\nExported ${stamp} · ${ids.length} messages · Format: [HH:MM] Sender: text, "> " = quoted message being replied to\n` + out.join('\n') + '\n';
  return { md, chat, stamp, count: ids.length };
}

document.getElementById('dbg').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: debugDump });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([result], { type: 'text/plain' }));
  a.download = 'wa_debug.txt';
  a.click();
  status('Debug dump saved');
};

// Dumps structure of the last messages; letters masked (x), digits/punctuation/emoji kept.
function debugDump() {
  const mask = (s) => s.replace(/\p{L}/gu, 'x');
  const main = document.querySelector('#main');
  if (!main) return 'kein #main';
  const clone = main.cloneNode(true);
  clone.querySelectorAll('svg path, style').forEach((e) => e.remove());
  clone.querySelectorAll('[src]').forEach((e) => e.setAttribute('src', e.getAttribute('src').slice(0, 20)));
  clone.querySelectorAll('[class]').forEach((e) => {
    const keep = [...e.classList].filter((c) => !/^x[0-9a-z]{4,8}$/.test(c));
    keep.length ? e.setAttribute('class', keep.join(' ')) : e.removeAttribute('class');
  });
  const walk = (el) => {
    for (const a of [...el.attributes || []]) {
      if (!['data-pre-plain-text', 'aria-label', 'title', 'href'].includes(a.name)) continue;
      el.setAttribute(a.name, mask(a.value));
    }
    el.childNodes.forEach((c) => (c.nodeType === 3 ? (c.textContent = mask(c.textContent)) : walk(c)));
  };
  walk(clone);
  const rows = [...clone.querySelectorAll('[role="row"]')].slice(-25);
  const ids = [...main.querySelectorAll('[data-id]')].slice(-5).map((e) => e.tagName + ' ' + mask(e.dataset.id));
  return `rows=${clone.querySelectorAll('[role="row"]').length}\ndata-id samples:\n${ids.join('\n')}\n\n` +
    (rows.length ? rows.map((r) => r.outerHTML).join('\n\n=====\n\n') : clone.outerHTML.slice(0, 200000));
}
