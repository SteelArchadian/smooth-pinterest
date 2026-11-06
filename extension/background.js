// Smooth Pinterest service worker: checks GitHub for a newer
// release and, when asked, hands the install to the native helper. The
// helper is started only for an update and exits when the port closes.

const HOST = 'com.smoothpinterest.helper';
const REPO = 'SteelArchadian/smooth-pinterest';
const ASSET = 'SmoothPinterest.zip';
const CHECK_EVERY_MIN = 360;
const DEFAULTS = { autoUpdate: true };

let port = null;

const currentVersion = () => chrome.runtime.getManifest().version;
const setUpdateState = (s) => chrome.storage.local.set({ updateState: s });
const getSettings = () => chrome.storage.local.get(DEFAULTS);

// Numeric compare of dotted versions: >0 when a is newer than b.
function cmpVersion(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function checkForUpdate() {
  await setUpdateState({ state: 'checking', message: 'Checking…' });
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=5`,
      { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error('GitHub answered ' + r.status);
    const rel = (await r.json()).find((x) => !x.draft);
    if (!rel) throw new Error('no releases found');
    const latest = String(rel.tag_name).replace(/^v/i, '');
    const asset = (rel.assets || []).find((a) => a.name === ASSET);
    const sha = /SHA-?256\D{0,60}([A-Fa-f0-9]{64})/i.exec(rel.body || '');
    const prev = (await chrome.storage.local.get('update')).update;
    const update = {
      latest,
      available: cmpVersion(latest, currentVersion()) > 0,
      url: asset ? asset.browser_download_url : '',
      sha: sha ? sha[1] : '',
      page: rel.html_url,
      failedFor: prev && prev.failedFor,
      checkedAt: Date.now(),
    };
    await chrome.storage.local.set({ update });
    await setUpdateState({
      state: 'idle',
      message: update.available ? `Version ${latest} is available.` : "You're up to date.",
    });
    chrome.action.setBadgeText({ text: update.available ? '!' : '' });
    return update;
  } catch (e) {
    await setUpdateState({ state: 'failed', message: "Couldn't check: " + e.message });
    return null;
  }
}

function closePort() {
  if (port) { try { port.disconnect(); } catch (_) {} }
  port = null;
}

async function installUpdate() {
  const { update } = await chrome.storage.local.get('update');
  if (!update || !update.available) return;
  if (!update.url || !update.sha) {
    await setUpdateState({ state: 'failed', message: 'This release has no verifiable download. Get it from GitHub.' });
    return;
  }
  closePort();
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    port = null;
    await setUpdateState({ state: 'failed', message: 'Helper not installed. Run SmoothPinterest.exe once.' });
    return;
  }
  port.onMessage.addListener(async (msg) => {
    if (msg && msg.type === 'updated') {
      await setUpdateState({ state: 'idle', message: 'Updated. Reloading…' });
      chrome.runtime.reload();
    } else if (msg && msg.type === 'updateFailed') {
      const cur = (await chrome.storage.local.get('update')).update;
      if (cur) await chrome.storage.local.set({ update: { ...cur, failedFor: cur.latest } });
      await setUpdateState({ state: 'failed', message: 'Update failed: ' + (msg.error || 'unknown error') });
      closePort();
    }
  });
  port.onDisconnect.addListener(async () => {
    const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
    port = null;
    const { updateState } = await chrome.storage.local.get('updateState');
    if (updateState && updateState.state === 'installing')
      await setUpdateState({ state: 'failed', message: 'Helper not running' + (err ? ': ' + err : '.') });
  });
  await setUpdateState({ state: 'installing', message: `Installing ${update.latest}…` });
  port.postMessage({ type: 'update', url: update.url, sha256: update.sha });
}

async function autoUpdateTick() {
  const s = await getSettings();
  if (!s.autoUpdate) return;
  const update = await checkForUpdate();
  // A failed install isn't retried every cycle for the same version.
  if (update && update.available && update.failedFor !== update.latest)
    await installUpdate();
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'update-check') autoUpdateTick(); });

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (!msg) return;
  if (msg.type === 'checkUpdate') { checkForUpdate().then(reply); return true; }
  if (msg.type === 'installUpdate') { installUpdate().then(() => reply()); return true; }
});

function start() {
  chrome.alarms.create('update-check', { delayInMinutes: 1, periodInMinutes: CHECK_EVERY_MIN });
}
chrome.runtime.onStartup.addListener(start);
chrome.runtime.onInstalled.addListener(start);
