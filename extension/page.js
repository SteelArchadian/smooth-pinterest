// Runs in the page's own world. When content.js is about to click a pin
// link for the keyboard slideshow, the next history.pushState becomes a
// replaceState, so stepping through pins does not fill the Back button.
(() => {
  document.addEventListener('pwasd-arm', () => {
    const push = history.pushState;
    history.pushState = function () {
      history.pushState = push;
      return history.replaceState.apply(history, arguments);
    };
    setTimeout(() => { if (history.pushState !== push) history.pushState = push; }, 500);
  });
})();

// Records the page's own /resource/ API calls (name, method, request data,
// status) so "Copy diagnostics" can show how Pinterest itself likes/saves.
(() => {
  const emit = (o) => { try { document.dispatchEvent(new CustomEvent('pwasd-net', { detail: JSON.stringify(o) })); } catch (_) {} };
  const short = (u) => { try { return new URL(u, location.href).pathname; } catch (_) { return String(u); } };
  const raw = (b) => (typeof b === 'string' ? b : (b instanceof URLSearchParams ? b.toString() : '')).slice(0, 8000);
  const search = (u) => { try { return new URL(u, location.href).search.slice(1); } catch (_) { return ''; } };
  const body = (b) => { try { return typeof b === 'string' ? decodeURIComponent(b.replace(/\+/g, ' ')).slice(0, 500) : ''; } catch (_) { return ''; } };
  const of = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const p = url.indexOf('/resource/') >= 0 ? short(url) : null;
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const pr = of.apply(this, arguments);
    if (p) pr.then((r) => emit({ m: method, p, s: r.status, d: method === 'GET' ? '' : body(init && init.body), r: method === 'GET' ? search(url) : raw(init && init.body) }), () => {});
    return pr;
  };
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this._pw = { m: String(m).toUpperCase(), u: String(u) }; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    const q = this._pw;
    if (q && q.u.indexOf('/resource/') >= 0) this.addEventListener('loadend', () => emit({ m: q.m, p: short(q.u), s: this.status, d: q.m === 'GET' ? '' : body(b), r: q.m === 'GET' ? search(q.u) : raw(b) }));
    return os.apply(this, arguments);
  };
})();
