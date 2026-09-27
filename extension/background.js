/** Service worker — owns the offscreen document and relays encode jobs. */
'use strict';

let creating = null;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existing.length) return;
  if (creating) return creating;
  creating = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Re-encode the selected video locally before upload.',
  });
  await creating;
  creating = null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'vg-background' && msg.type === 'transcode') {
    (async () => {
      try {
        await ensureOffscreen();
        const res = await chrome.runtime.sendMessage({
          target: 'vg-offscreen', type: 'transcode', payload: msg.payload,
        });
        sendResponse(res);
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
  // relay progress from offscreen → the content script that asked
  if (msg.target === 'vg-progress') {
    chrome.tabs.query({ url: ['https://www.tiktok.com/*', 'https://www.instagram.com/*'] })
      .then(tabs => tabs.forEach(t =>
        chrome.tabs.sendMessage(t.id, { target: 'vg-content', ...msg }).catch(() => {})));
  }
});
