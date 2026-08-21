/* ==========================================================================
   Vanish — disposable email front-end for the public Mail.tm API
   Vanilla ES6+, no build step, no framework.
   API docs: https://docs.mail.tm
   ========================================================================== */

(() => {
  'use strict';

  // ------------------------------------------------------------------------
  // Config & state
  // ------------------------------------------------------------------------
  const API_BASE = 'https://api.mail.tm';
  const POLL_MS = 6000;
  const STORAGE_KEY = 'vanish.account.v1';

  const state = {
    domains: [],
    account: null,       // { id, address, password, token }
    messages: [],         // list from /messages
    activeMessageId: null,
    pollTimer: null,
    countdownTimer: null,
    msRemaining: POLL_MS,
    isFetchingList: false,
    isBusy: false,        // global "an account-level action is in flight"
  };

  // ------------------------------------------------------------------------
  // DOM refs
  // ------------------------------------------------------------------------
  const el = {
    addressText: document.getElementById('address-text'),
    addressCursor: document.getElementById('address-cursor'),
    addressBox: document.getElementById('address-box'),
    addressSkeleton: document.getElementById('address-skeleton'),
    expiryNote: document.getElementById('expiry-note'),

    btnCopy: document.getElementById('btn-copy'),
    copyTooltip: document.getElementById('copy-tooltip'),
    btnRefresh: document.getElementById('btn-refresh'),
    btnRandom: document.getElementById('btn-random'),
    btnDelete: document.getElementById('btn-delete'),

    inputPrefix: document.getElementById('input-prefix'),
    selectDomain: document.getElementById('select-domain'),
    btnCreateCustom: document.getElementById('btn-create-custom'),

    pollBar: document.getElementById('poll-bar'),
    pollLabel: document.getElementById('poll-label'),

    inboxList: document.getElementById('inbox-list'),
    inboxEmpty: document.getElementById('inbox-empty'),
    inboxCount: document.getElementById('inbox-count'),

    viewerEmpty: document.getElementById('viewer-empty'),
    viewerContent: document.getElementById('viewer-content'),
    viewerSubject: document.getElementById('viewer-subject'),
    viewerFrom: document.getElementById('viewer-from'),
    viewerDate: document.getElementById('viewer-date'),
    viewerAttachments: document.getElementById('viewer-attachments'),
    viewerFrame: document.getElementById('viewer-frame'),
    btnCloseViewer: document.getElementById('btn-close-viewer'),

    toast: document.getElementById('toast'),
    toastText: document.getElementById('toast-text'),
  };

  let toastTimer = null;

  // ------------------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------------------

  function showToast(message, kind = 'info') {
    el.toastText.textContent = message;
    el.toast.classList.remove('hidden');
    el.toast.classList.add('flex');
    const icon = el.toast.querySelector('i');
    icon.setAttribute('data-lucide', kind === 'error' ? 'alert-triangle' : 'info');
    icon.classList.toggle('text-red-400', kind === 'error');
    icon.classList.toggle('text-signal', kind !== 'error');
    renderIcons();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.add('hidden');
      el.toast.classList.remove('flex');
    }, 3200);
  }

  function renderIcons() {
    if (window.lucide) window.lucide.createIcons();
  }

  function randomString(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    const arr = new Uint32Array(len);
    crypto.getRandomValues(arr);
    for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
    return out;
  }

  function randomPassword() {
    return randomString(10) + 'A1!';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return `Today, ${time}`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ` · ${time}`;
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function senderLabel(from) {
    if (!from) return 'Unknown sender';
    return from.name && from.name.trim() ? from.name : (from.address || 'Unknown sender');
  }

  function setBusy(isBusy) {
    state.isBusy = isBusy;
    [el.btnCopy, el.btnRefresh, el.btnRandom, el.btnDelete, el.btnCreateCustom].forEach((btn) => {
      btn.disabled = isBusy;
      btn.classList.toggle('opacity-50', isBusy);
      btn.classList.toggle('cursor-not-allowed', isBusy);
    });
  }

  function setAddressLoading(isLoading) {
    el.addressSkeleton.classList.toggle('hidden', !isLoading);
    el.addressCursor.classList.toggle('hidden', isLoading);
  }

  function spin(btn, spinning) {
    const icon = btn.querySelector('i');
    if (!icon) return;
    icon.classList.toggle('animate-spin', spinning);
  }

  // ------------------------------------------------------------------------
  // API layer
  // ------------------------------------------------------------------------

  async function apiRequest(path, { method = 'GET', body, auth = false, timeoutMs = 15000 } = {}) {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/ld+json' };
    if (auth) {
      if (!state.account?.token) throw new Error('No active session.');
      headers['Authorization'] = `Bearer ${state.account.token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') throw new Error('The request timed out. Check your connection and try again.');
      throw new Error('Could not reach the mail server. Check your connection and try again.');
    }
    clearTimeout(timeout);

    if (res.status === 204) return null;

    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }

    if (!res.ok) {
      const msg = data?.['hydra:description'] || data?.detail || data?.message || `Request failed (${res.status}).`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }

    return data;
  }

  async function fetchDomains() {
    const data = await apiRequest('/domains?page=1');
    const members = data?.['hydra:member'] || [];
    return members.filter((d) => d.isActive).map((d) => d.domain);
  }

  async function createAccount(address, password) {
    return apiRequest('/accounts', { method: 'POST', body: { address, password } });
  }

  async function login(address, password) {
    const data = await apiRequest('/token', { method: 'POST', body: { address, password } });
    return data.token;
  }

  async function deleteAccountRemote(id) {
    return apiRequest(`/accounts/${id}`, { method: 'DELETE', auth: true });
  }

  async function fetchMessageList() {
    const data = await apiRequest('/messages?page=1', { auth: true });
    return data?.['hydra:member'] || [];
  }

  async function fetchMessageDetail(id) {
    return apiRequest(`/messages/${id}`, { auth: true });
  }

  async function markMessageSeen(id) {
    try {
      await fetch(`${API_BASE}/messages/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/merge-patch+json',
          Authorization: `Bearer ${state.account.token}`,
        },
        body: JSON.stringify({ seen: true }),
      });
    } catch {
      /* non-critical — local UI state already reflects "seen" */
    }
  }

  async function downloadAttachment(downloadUrl, filename) {
    const res = await fetch(`${API_BASE}${downloadUrl}`, {
      headers: { Authorization: `Bearer ${state.account.token}` },
    });
    if (!res.ok) throw new Error('Could not download this attachment.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'attachment';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // ------------------------------------------------------------------------
  // Account lifecycle
  // ------------------------------------------------------------------------

  function persistAccount() {
    if (!state.account) { localStorage.removeItem(STORAGE_KEY); return; }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.account));
  }

  function loadPersistedAccount() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function populateDomainSelect() {
    el.selectDomain.innerHTML = '';
    state.domains.forEach((domain) => {
      const opt = document.createElement('option');
      opt.value = domain;
      opt.textContent = `@${domain}`;
      el.selectDomain.appendChild(opt);
    });
  }

  async function initDomains() {
    try {
      state.domains = await fetchDomains();
      if (!state.domains.length) throw new Error('No active domains returned.');
      await populateDomainSelect();
      return true;
    } catch (err) {
      el.selectDomain.innerHTML = '<option>unavailable</option>';
      showToast(err.message || 'Could not load domains from Mail.tm.', 'error');
      return false;
    }
  }

  async function tryRestoreAccount() {
    const saved = loadPersistedAccount();
    if (!saved) return false;
    try {
      // Verify the token / account is still valid.
      await apiRequestWithAccount(saved);
      state.account = saved;
      return true;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
  }

  async function apiRequestWithAccount(account) {
    const res = await fetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${account.token}` },
    });
    if (!res.ok) throw new Error('Session expired.');
    return res.json();
  }

  async function provisionRandomAccount() {
    if (!state.domains.length) {
      const ok = await initDomains();
      if (!ok) throw new Error('No domains available to create an address.');
    }
    const domain = state.domains[Math.floor(Math.random() * state.domains.length)];
    const address = `${randomString(9)}@${domain}`;
    const password = randomPassword();
    await createAccount(address, password);
    const token = await login(address, password);
    const me = await apiRequestWithAccount({ token });
    return { id: me.id, address, password, token };
  }

  async function provisionCustomAccount(prefix, domain) {
    const clean = prefix.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!clean) throw new Error('Enter a username using letters, numbers, dots, or dashes.');
    if (!domain) throw new Error('Choose a domain first.');
    const address = `${clean}@${domain}`;
    const password = randomPassword();
    await createAccount(address, password);
    const token = await login(address, password);
    const me = await apiRequestWithAccount({ token });
    return { id: me.id, address, password, token };
  }

  function stopPolling() {
    clearInterval(state.pollTimer);
    clearInterval(state.countdownTimer);
    state.pollTimer = null;
    state.countdownTimer = null;
  }

  function startPolling() {
    stopPolling();
    state.msRemaining = POLL_MS;
    state.pollTimer = setInterval(() => {
      state.msRemaining = POLL_MS;
      refreshMessages({ silent: true });
    }, POLL_MS);

    state.countdownTimer = setInterval(() => {
      state.msRemaining = Math.max(0, state.msRemaining - 100);
      const pct = 100 - (state.msRemaining / POLL_MS) * 100;
      el.pollBar.style.width = `${pct}%`;
      el.pollLabel.textContent = `next check ${Math.ceil(state.msRemaining / 1000)}s`;
    }, 100);
  }

  async function activateAccount(account, { announce = true } = {}) {
    stopPolling();
    state.account = account;
    state.messages = [];
    state.activeMessageId = null;
    persistAccount();

    el.addressText.textContent = account.address;
    setAddressLoading(false);
    el.expiryNote.textContent = 'Active session';
    resetViewer();
    renderInboxSkeleton(false);

    await refreshMessages({ silent: true });
    startPolling();
    if (announce) showToast('New address ready.');
  }

  // ------------------------------------------------------------------------
  // Rendering — inbox list
  // ------------------------------------------------------------------------

  function renderInboxSkeleton(show) {
    // Remove any existing skeleton rows
    el.inboxList.querySelectorAll('.msg-skeleton').forEach((n) => n.remove());
    if (!show) return;
    el.inboxEmpty.classList.add('hidden');
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div');
      row.className = 'msg-skeleton';
      row.innerHTML = `
        <div class="bar w-2/3 mb-2"></div>
        <div class="bar w-1/2 mb-2"></div>
        <div class="bar w-full"></div>
      `;
      el.inboxList.appendChild(row);
    }
  }

  function renderInbox() {
    // Clear all message nodes (keep the empty-state node reference)
    el.inboxList.querySelectorAll('.msg-item').forEach((n) => n.remove());
    renderInboxSkeleton(false);

    el.inboxCount.textContent = String(state.messages.length);

    if (!state.messages.length) {
      el.inboxEmpty.classList.remove('hidden');
      return;
    }
    el.inboxEmpty.classList.add('hidden');

    const sorted = [...state.messages].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    sorted.forEach((msg) => {
      const isActive = msg.id === state.activeMessageId;
      const isUnread = msg.seen === false;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `msg-item block${isActive ? ' active' : ''}`;
      btn.dataset.id = msg.id;
      btn.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <span class="text-sm font-medium text-ink-100 truncate">${escapeHtml(senderLabel(msg.from))}</span>
          <span class="shrink-0 flex items-center gap-1.5">
            ${isUnread ? '<span class="badge-new">New</span>' : ''}
            <span class="text-[11px] text-ink-500 font-mono whitespace-nowrap">${escapeHtml(formatDate(msg.createdAt))}</span>
          </span>
        </div>
        <p class="text-sm text-ink-300 mt-0.5 truncate">${escapeHtml(msg.subject || '(no subject)')}</p>
        <p class="msg-snippet text-xs text-ink-500 mt-0.5">${escapeHtml(msg.intro || '')}</p>
      `;
      btn.addEventListener('click', () => openMessage(msg.id));
      el.inboxList.appendChild(btn);
    });
  }

  // ------------------------------------------------------------------------
  // Rendering — message viewer
  // ------------------------------------------------------------------------

  function resetViewer() {
    state.activeMessageId = null;
    el.viewerContent.classList.add('hidden');
    el.viewerContent.classList.remove('mobile-open');
    el.viewerEmpty.classList.remove('hidden');
    el.viewerFrame.srcdoc = '';
    el.viewerAttachments.innerHTML = '';
    el.viewerAttachments.classList.add('hidden');
  }

  async function openMessage(id) {
    state.activeMessageId = id;
    renderInbox(); // reflect active + optimistic "seen" highlight

    el.viewerEmpty.classList.add('hidden');
    el.viewerContent.classList.remove('hidden');
    el.viewerContent.classList.add('mobile-open');
    el.viewerSubject.textContent = 'Loading…';
    el.viewerFrom.textContent = '';
    el.viewerDate.textContent = '';
    el.viewerFrame.srcdoc = '<div style="font-family:sans-serif;padding:24px;color:#94A3B5">Loading message…</div>';
    el.viewerAttachments.classList.add('hidden');
    el.viewerAttachments.innerHTML = '';

    try {
      const msg = await fetchMessageDetail(id);

      // Update local cache so the badge disappears without a full refetch.
      const cached = state.messages.find((m) => m.id === id);
      if (cached) cached.seen = true;
      markMessageSeen(id);
      renderInbox();

      if (state.activeMessageId !== id) return; // user clicked away while loading

      el.viewerSubject.textContent = msg.subject || '(no subject)';
      el.viewerFrom.textContent = `${senderLabel(msg.from)}${msg.from?.address ? ` <${msg.from.address}>` : ''}`;
      el.viewerDate.textContent = formatDate(msg.createdAt);

      let html = '';
      if (msg.html && msg.html.length) {
        html = Array.isArray(msg.html) ? msg.html.join('') : msg.html;
      } else {
        const text = msg.text || '(This message has no readable content.)';
        html = `<pre style="white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,monospace;font-size:13px;line-height:1.6;margin:0;">${escapeHtml(text)}</pre>`;
      }
      const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8">
        <base target="_blank">
        <style>
          html,body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;background:#fff;word-wrap:break-word;}
          img{max-width:100%;height:auto;}
          a{color:#0b6b4d;}
          table{max-width:100%;}
        </style></head><body>${html}</body></html>`;
      el.viewerFrame.srcdoc = wrapped;

      const attachments = msg.attachments || [];
      if (attachments.length) {
        el.viewerAttachments.classList.remove('hidden');
        attachments.forEach((att) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'attachment-chip';
          chip.innerHTML = `<i data-lucide="paperclip" style="width:13px;height:13px"></i>
            <span>${escapeHtml(att.filename || 'attachment')}</span>
            <span class="text-ink-500">${escapeHtml(formatBytes(att.size))}</span>`;
          chip.addEventListener('click', async () => {
            chip.disabled = true;
            const original = chip.innerHTML;
            chip.innerHTML = `<i data-lucide="loader-2" class="animate-spin" style="width:13px;height:13px"></i><span>Downloading…</span>`;
            renderIcons();
            try {
              await downloadAttachment(att.downloadUrl, att.filename);
            } catch (err) {
              showToast(err.message || 'Download failed.', 'error');
            } finally {
              chip.disabled = false;
              chip.innerHTML = original;
              renderIcons();
            }
          });
          el.viewerAttachments.appendChild(chip);
        });
      }

      renderIcons();
    } catch (err) {
      if (state.activeMessageId !== id) return;
      el.viewerSubject.textContent = 'Could not load this message';
      el.viewerFrame.srcdoc = `<div style="font-family:sans-serif;padding:24px;color:#b91c1c">${escapeHtml(err.message || 'Something went wrong.')}</div>`;
      showToast(err.message || 'Could not load this message.', 'error');
    }
  }

  // ------------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------------

  async function refreshMessages({ silent = false } = {}) {
    if (!state.account || state.isFetchingList) return;
    state.isFetchingList = true;
    if (!silent) spin(el.btnRefresh, true);

    try {
      const list = await fetchMessageList();
      const previousIds = new Set(state.messages.map((m) => m.id));
      const arrivedNew = list.some((m) => !previousIds.has(m.id));

      // Preserve local "seen" overrides for the currently open message,
      // since the list endpoint reflects server state which may lag
      // the optimistic PATCH we just fired.
      const seenOverrides = new Map(
        state.messages.filter((m) => m.seen).map((m) => [m.id, true])
      );
      list.forEach((m) => {
        if (seenOverrides.has(m.id)) m.seen = true;
      });

      state.messages = list;
      renderInbox();

      if (arrivedNew && previousIds.size > 0) {
        showToast('New mail just arrived.');
      }
    } catch (err) {
      if (!silent) showToast(err.message || 'Could not refresh the inbox.', 'error');
    } finally {
      state.isFetchingList = false;
      if (!silent) spin(el.btnRefresh, false);
    }
  }

  async function handleCopy() {
    if (!state.account) return;
    try {
      await navigator.clipboard.writeText(state.account.address);
    } catch {
      // Fallback for browsers/contexts without Clipboard API permission
      const ta = document.createElement('textarea');
      ta.value = state.account.address;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    el.copyTooltip.classList.add('show');
    el.addressBox.classList.add('flash-copied');
    setTimeout(() => {
      el.copyTooltip.classList.remove('show');
      el.addressBox.classList.remove('flash-copied');
    }, 1500);
  }

  async function handleNewRandomAddress() {
    if (state.isBusy) return;
    setBusy(true);
    spin(el.btnRandom, true);
    setAddressLoading(true);
    el.addressText.textContent = 'generating…';
    try {
      const account = await provisionRandomAccount();
      await activateAccount(account);
    } catch (err) {
      showToast(err.message || 'Could not generate a new address.', 'error');
      el.addressText.textContent = state.account?.address || 'unavailable';
      setAddressLoading(false);
    } finally {
      setBusy(false);
      spin(el.btnRandom, false);
    }
  }

  async function handleCreateCustom() {
    if (state.isBusy) return;
    const prefix = el.inputPrefix.value;
    const domain = el.selectDomain.value;
    setBusy(true);
    spin(el.btnCreateCustom, true);
    try {
      const account = await provisionCustomAccount(prefix, domain);
      await activateAccount(account);
      el.inputPrefix.value = '';
    } catch (err) {
      showToast(err.message || 'Could not create that address. It may already be taken.', 'error');
    } finally {
      setBusy(false);
      spin(el.btnCreateCustom, false);
    }
  }

  async function handleDelete() {
    if (state.isBusy || !state.account) return;
    setBusy(true);
    spin(el.btnDelete, true);
    stopPolling();
    try {
      await deleteAccountRemote(state.account.id);
    } catch {
      // Even if the remote delete fails (e.g. already expired), proceed to
      // provision a fresh address so the user is never stuck.
    }
    try {
      showToast('Address deleted. Provisioning a new one…');
      const account = await provisionRandomAccount();
      await activateAccount(account, { announce: false });
      showToast('Old address deleted — new one is ready.');
    } catch (err) {
      showToast(err.message || 'Deleted, but could not create a replacement address.', 'error');
    } finally {
      setBusy(false);
      spin(el.btnDelete, false);
    }
  }

  async function handleManualRefresh() {
    state.msRemaining = POLL_MS;
    await refreshMessages({ silent: false });
  }

  // ------------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------------

  function bindEvents() {
    el.btnCopy.addEventListener('click', handleCopy);
    el.btnRefresh.addEventListener('click', handleManualRefresh);
    el.btnRandom.addEventListener('click', handleNewRandomAddress);
    el.btnDelete.addEventListener('click', () => {
      if (confirm('Delete this address? Any mail in it will be gone for good.')) {
        handleDelete();
      }
    });
    el.btnCreateCustom.addEventListener('click', handleCreateCustom);
    el.inputPrefix.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleCreateCustom();
    });
    el.btnCloseViewer.addEventListener('click', () => {
      el.viewerContent.classList.remove('mobile-open');
      el.viewerContent.classList.add('hidden');
      el.viewerEmpty.classList.remove('hidden');
      state.activeMessageId = null;
      renderInbox();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.account) {
        refreshMessages({ silent: true });
      }
    });
  }

  // ------------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------------

  async function boot() {
    renderIcons();
    bindEvents();
    setAddressLoading(true);
    renderInboxSkeleton(true);

    await initDomains();

    const restored = await tryRestoreAccount();
    if (restored) {
      await activateAccount(state.account, { announce: false });
      showToast('Welcome back — restored your last address.');
      return;
    }

    try {
      const account = await provisionRandomAccount();
      await activateAccount(account, { announce: false });
    } catch (err) {
      setAddressLoading(false);
      el.addressText.textContent = 'unavailable';
      renderInboxSkeleton(false);
      showToast(err.message || 'Could not reach Mail.tm to create an address.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
