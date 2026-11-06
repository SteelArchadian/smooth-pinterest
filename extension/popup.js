const $ = (id) => document.getElementById(id);
$('ver').textContent = chrome.runtime.getManifest().version;

function render(update, state) {
  $('status').textContent = state ? state.message || '' : '';
  $('install').hidden = !(update && update.available);
  $('install').disabled = !!state && state.state === 'installing';
  $('notes').hidden = !(update && update.page);
  if (update && update.page) $('notes').onclick = () => chrome.tabs.create({ url: update.page });
}

const load = () => chrome.storage.local.get(['update', 'updateState', 'autoUpdate', 'viewer', 'related'])
  .then((r) => { $('auto').checked = r.autoUpdate !== false; $('viewer').checked = r.viewer !== false; $('related').checked = !!r.related; render(r.update, r.updateState); });

$('auto').onchange = () => chrome.storage.local.set({ autoUpdate: $('auto').checked });
$('viewer').onchange = () => chrome.storage.local.set({ viewer: $('viewer').checked });
$('related').onchange = () => chrome.storage.local.set({ related: $('related').checked });
$('check').onclick = () => chrome.runtime.sendMessage({ type: 'checkUpdate' });
$('install').onclick = () => chrome.runtime.sendMessage({ type: 'installUpdate' });
chrome.storage.onChanged.addListener(load);
load();

$('diag').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let text;
  try {
    const d = await chrome.tabs.sendMessage(tab.id, { type: 'diag' });
    text = JSON.stringify({ version: chrome.runtime.getManifest().version, ...d }, null, 1);
  } catch (e) {
    text = 'No diagnostics from this tab (open a Pinterest page and reload it): ' + e.message;
  }
  await navigator.clipboard.writeText(text);
  $('status').textContent = 'Diagnostics copied to the clipboard.';
};
