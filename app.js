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

  // Polling interval.
  // 6 seconds keeps the inbox feeling live without hammering the API.
  const POLL_MS = 6000;

  // Local storage keys.
  const STORAGE_KEY = 'vanish.account.v1';

  // Mail.tm has rate limits on account creation.
  // This local cooldown prevents repeatedly creating accounts from the same
  // browser and hitting the API's rate limit.
  const ACCOUNT_CREATE_COOLDOWN_MS = 60000;
  const ACCOUNT_CREATE_KEY = 'vanish.account-created-at.v1';

  const state = {
    domains: [],
    account: null,       // { id, address, password, token }
    messages: [],
    activeMessageId: null,

    pollTimer: null,
    countdownTimer: null,

    msRemaining: POLL_MS,

    isFetchingList: false,
    isBusy: false,
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
    if (!el.toast || !el.toastText) return;

    el.toastText.textContent = message;

    el.toast.classList.remove('hidden');
    el.toast.classList.add('flex');

    const icon = el.toast.querySelector('i');

    if (icon) {
      icon.setAttribute(
        'data-lucide',
        kind === 'error' ? 'alert-triangle' : 'info'
      );

      icon.classList.toggle('text-red-400', kind === 'error');
      icon.classList.toggle('text-signal', kind !== 'error');

      renderIcons();
    }

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      el.toast.classList.add('hidden');
      el.toast.classList.remove('flex');
    }, 3200);
  }

  function renderIcons() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function randomString(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';

    let out = '';

    const arr = new Uint32Array(len);

    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < len; i++) {
        arr[i] = Math.floor(Math.random() * 0xffffffff);
      }
    }

    for (let i = 0; i < len; i++) {
      out += chars[arr[i] % chars.length];
    }

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

    if (Number.isNaN(d.getTime())) return '';

    const now = new Date();

    const sameDay =
      d.toDateString() === now.toDateString();

    const time = d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });

    if (sameDay) {
      return `Today, ${time}`;
    }

    return (
      d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }) +
      ` · ${time}`
    );
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';

    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function senderLabel(from) {
    if (!from) {
      return 'Unknown sender';
    }

    if (from.name && from.name.trim()) {
      return from.name;
    }

    return from.address || 'Unknown sender';
  }

  function setBusy(isBusy) {
    state.isBusy = isBusy;

    [
      el.btnCopy,
      el.btnRefresh,
      el.btnRandom,
      el.btnDelete,
      el.btnCreateCustom,
    ].forEach((btn) => {
      if (!btn) return;

      btn.disabled = isBusy;

      btn.classList.toggle('opacity-50', isBusy);
      btn.classList.toggle('cursor-not-allowed', isBusy);
    });
  }

  function setAddressLoading(isLoading) {
    if (el.addressSkeleton) {
      el.addressSkeleton.classList.toggle(
        'hidden',
        !isLoading
      );
    }

    if (el.addressCursor) {
      el.addressCursor.classList.toggle(
        'hidden',
        isLoading
      );
    }
  }

  function spin(btn, spinning) {
    if (!btn) return;

    const icon = btn.querySelector('i');

    if (!icon) return;

    icon.classList.toggle(
      'animate-spin',
      spinning
    );
  }

  // ------------------------------------------------------------------------
  // API layer
  // ------------------------------------------------------------------------

  async function apiRequest(
    path,
    {
      method = 'GET',
      body,
      auth = false,
      timeoutMs = 15000,
    } = {}
  ) {
    const headers = {
      Accept: 'application/ld+json, application/json',
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (auth) {
      if (!state.account?.token) {
        throw new Error('No active session.');
      }

      headers['Authorization'] =
        `Bearer ${state.account.token}`;
    }

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let res;

    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body:
          body !== undefined
            ? JSON.stringify(body)
            : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);

      if (err.name === 'AbortError') {
        throw new Error(
          'The request timed out. Check your connection and try again.'
        );
      }

      throw new Error(
        'Could not reach the mail server. Check your connection and try again.'
      );
    }

    clearTimeout(timeout);

    if (res.status === 204) {
      return null;
    }

    let data = null;

    const text = await res.text();

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      // Mail.tm documents HTTP 429 as the rate-limit response.
      if (res.status === 429) {
        const retryAfterHeader =
          res.headers.get('Retry-After');

        const retryAfter =
          Number(retryAfterHeader);

        const wait =
          Number.isFinite(retryAfter) &&
          retryAfter > 0
            ? `${retryAfter} seconds`
            : 'a little while';

        const err = new Error(
          `Mail.tm is rate-limiting requests. Please wait ${wait} before creating another address.`
        );

        err.status = 429;
        err.retryAfter =
          retryAfter || null;

        throw err;
      }

      const msg =
        data?.['hydra:description'] ||
        data?.detail ||
        data?.message ||
        `Request failed (${res.status}).`;

      const err = new Error(msg);

      err.status = res.status;

      throw err;
    }

    return data;
  }

  async function fetchDomains() {
    const data =
      await apiRequest('/domains?page=1');

    const members =
      data?.['hydra:member'] || [];

    return members
      .filter((domain) => domain.isActive)
      .map((domain) => domain.domain);
  }

  async function createAccount(
    address,
    password
  ) {
    return apiRequest('/accounts', {
      method: 'POST',
      body: {
        address,
        password,
      },
    });
  }

  async function login(
    address,
    password
  ) {
    const data =
      await apiRequest('/token', {
        method: 'POST',
        body: {
          address,
          password,
        },
      });

    if (!data?.token) {
      throw new Error(
        'Mail.tm did not return a login token.'
      );
    }

    return data.token;
  }

  async function deleteAccountRemote(id) {
    return apiRequest(
      `/accounts/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        auth: true,
      }
    );
  }

  async function fetchMessageList() {
    const data =
      await apiRequest(
        '/messages?page=1',
        {
          auth: true,
        }
      );

    return data?.['hydra:member'] || [];
  }

  async function fetchMessageDetail(id) {
    return apiRequest(
      `/messages/${encodeURIComponent(id)}`,
      {
        auth: true,
      }
    );
  }

  async function markMessageSeen(id) {
    if (!state.account?.token) {
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE}/messages/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',

          headers: {
            'Content-Type':
              'application/merge-patch+json',

            Accept:
              'application/ld+json, application/json',

            Authorization:
              `Bearer ${state.account.token}`,
          },

          body: JSON.stringify({
            seen: true,
          }),
        }
      );

      /*
       * Mail.tm uses PATCH /messages/{id} to mark
       * the message as read.
       *
       * The UI already changes the message to "seen"
       * optimistically, so failure here is non-critical.
       */
      if (!res.ok && res.status !== 404) {
        return;
      }
    } catch {
      // Non-critical.
    }
  }

  async function downloadAttachment(
    downloadUrl,
    filename
  ) {
    if (!state.account?.token) {
      throw new Error(
        'Your session has expired.'
      );
    }

    if (!downloadUrl) {
      throw new Error(
        'This attachment cannot be downloaded.'
      );
    }

    const url =
      downloadUrl.startsWith('http')
        ? downloadUrl
        : `${API_BASE}${downloadUrl}`;

    const res = await fetch(url, {
      headers: {
        Authorization:
          `Bearer ${state.account.token}`,
      },
    });

    if (!res.ok) {
      throw new Error(
        'Could not download this attachment.'
      );
    }

    const blob = await res.blob();

    const objectUrl =
      URL.createObjectURL(blob);

    const a =
      document.createElement('a');

    a.href = objectUrl;

    a.download =
      filename || 'attachment';

    document.body.appendChild(a);

    a.click();

    a.remove();

    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 4000);
  }

  // ------------------------------------------------------------------------
  // Account lifecycle
  // ------------------------------------------------------------------------

  function persistAccount() {
    if (!state.account) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state.account)
    );
  }

  function loadPersistedAccount() {
    try {
      const raw =
        localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return null;
      }

      const parsed =
        JSON.parse(raw);

      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !parsed.token ||
        !parsed.address
      ) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  async function populateDomainSelect() {
    if (!el.selectDomain) {
      return;
    }

    el.selectDomain.innerHTML = '';

    state.domains.forEach((domain) => {
      const opt =
        document.createElement('option');

      opt.value = domain;

      opt.textContent =
        `@${domain}`;

      el.selectDomain.appendChild(opt);
    });
  }

  async function initDomains() {
    try {
      state.domains =
        await fetchDomains();

      if (!state.domains.length) {
        throw new Error(
          'No active Mail.tm domains are available right now.'
        );
      }

      await populateDomainSelect();

      return true;
    } catch (err) {
      if (el.selectDomain) {
        el.selectDomain.innerHTML =
          '<option>unavailable</option>';
      }

      showToast(
        err.message ||
          'Could not load domains from Mail.tm.',
        'error'
      );

      return false;
    }
  }

  async function apiRequestWithAccount(
    account
  ) {
    if (!account?.token) {
      throw new Error(
        'No saved session token.'
      );
    }

    const res =
      await fetch(
        `${API_BASE}/me`,
        {
          headers: {
            Accept:
              'application/ld+json, application/json',

            Authorization:
              `Bearer ${account.token}`,
          },
        }
      );

    if (!res.ok) {
      throw new Error(
        'Session expired.'
      );
    }

    return res.json();
  }

  async function tryRestoreAccount() {
    const saved =
      loadPersistedAccount();

    if (!saved) {
      return false;
    }

    try {
      /*
       * Verify the saved token against /me.
       * This avoids trusting stale localStorage.
       */
      const me =
        await apiRequestWithAccount(saved);

      state.account = {
        ...saved,

        id:
          me.id || saved.id,

        address:
          me.address || saved.address,
      };

      persistAccount();

      return true;
    } catch {
      localStorage.removeItem(
        STORAGE_KEY
      );

      return false;
    }
  }

  function enforceAccountCreateCooldown() {
    const lastCreated =
      Number(
        localStorage.getItem(
          ACCOUNT_CREATE_KEY
        ) || 0
      );

    const elapsed =
      Date.now() - lastCreated;

    const remaining =
      ACCOUNT_CREATE_COOLDOWN_MS -
      elapsed;

    if (remaining > 0) {
      const seconds =
        Math.ceil(
          remaining / 1000
        );

      throw new Error(
        `Please wait about ${seconds}s before creating another address.`
      );
    }
  }

  function markAccountCreated() {
    localStorage.setItem(
      ACCOUNT_CREATE_KEY,
      String(Date.now())
    );
  }

  async function provisionRandomAccount() {
    enforceAccountCreateCooldown();

    if (!state.domains.length) {
      const ok =
        await initDomains();

      if (!ok) {
        throw new Error(
          'No domains are available to create an address.'
        );
      }
    }

    const domain =
      state.domains[
        Math.floor(
          Math.random() *
          state.domains.length
        )
      ];

    const address =
      `${randomString(9)}@${domain}`;

    const password =
      randomPassword();

    /*
     * Create the account first.
     */
    await createAccount(
      address,
      password
    );

    /*
     * Only start the local cooldown after
     * successful account creation.
     */
    markAccountCreated();

    /*
     * Get the bearer token.
     */
    const token =
      await login(
        address,
        password
      );

    /*
     * Fetch the actual account ID from /me.
     */
    const me =
      await apiRequestWithAccount({
        token,
      });

    return {
      id: me.id,
      address:
        me.address || address,
      password,
      token,
    };
  }

  async function provisionCustomAccount(
    prefix,
    domain
  ) {
    enforceAccountCreateCooldown();

    const clean =
      String(prefix || '')
        .trim()
        .toLowerCase()
        .replace(
          /[^a-z0-9._-]/g,
          ''
        );

    if (!clean) {
      throw new Error(
        'Enter a username using letters, numbers, dots, or dashes.'
      );
    }

    if (!domain) {
      throw new Error(
        'Choose a domain first.'
      );
    }

    const address =
      `${clean}@${domain}`;

    const password =
      randomPassword();

    await createAccount(
      address,
      password
    );

    markAccountCreated();

    const token =
      await login(
        address,
        password
      );

    const me =
      await apiRequestWithAccount({
        token,
      });

    return {
      id: me.id,
      address:
        me.address || address,
      password,
      token,
    };
  }

  // ------------------------------------------------------------------------
  // Polling
  // ------------------------------------------------------------------------

  function stopPolling() {
    clearInterval(
      state.pollTimer
    );

    clearInterval(
      state.countdownTimer
    );

    state.pollTimer = null;
    state.countdownTimer = null;
  }

  function startPolling() {
    stopPolling();

    state.msRemaining =
      POLL_MS;

    /*
     * Fetch messages every 6 seconds.
     */
    state.pollTimer =
      setInterval(() => {
        state.msRemaining =
          POLL_MS;

        refreshMessages({
          silent: true,
        });
      }, POLL_MS);

    /*
     * Update the existing polling progress
     * bar in the UI.
     */
    state.countdownTimer =
      setInterval(() => {
        state.msRemaining =
          Math.max(
            0,
            state.msRemaining - 100
          );

        const pct =
          100 -
          (
            state.msRemaining /
            POLL_MS
          ) *
          100;

        if (el.pollBar) {
          el.pollBar.style.width =
            `${pct}%`;
        }

        if (el.pollLabel) {
          el.pollLabel.textContent =
            `next check ${Math.ceil(
              state.msRemaining / 1000
            )}s`;
        }
      }, 100);
  }

  async function activateAccount(
    account,
    {
      announce = true,
    } = {}
  ) {
    stopPolling();

    state.account = account;
    state.messages = [];
    state.activeMessageId = null;

    persistAccount();

    el.addressText.textContent =
      account.address;

    setAddressLoading(false);

    el.expiryNote.textContent =
      'Active session';

    resetViewer();

    renderInboxSkeleton(false);

    /*
     * Get the current inbox immediately.
     */
    await refreshMessages({
      silent: true,
    });

    startPolling();

    if (announce) {
      showToast(
        'New address ready.'
      );
    }
  }

  // ------------------------------------------------------------------------
  // Rendering — inbox
  // ------------------------------------------------------------------------

  function renderInboxSkeleton(show) {
    if (!el.inboxList) {
      return;
    }

    el.inboxList
      .querySelectorAll(
        '.msg-skeleton'
      )
      .forEach((n) => n.remove());

    if (!show) {
      return;
    }

    el.inboxEmpty?.classList.add(
      'hidden'
    );

    for (let i = 0; i < 3; i++) {
      const row =
        document.createElement('div');

      row.className =
        'msg-skeleton';

      row.innerHTML = `
        <div class="bar w-2/3 mb-2"></div>
        <div class="bar w-1/2 mb-2"></div>
        <div class="bar w-full"></div>
      `;

      el.inboxList.appendChild(row);
    }
  }

  function renderInbox() {
    if (!el.inboxList) {
      return;
    }

    /*
     * Remove old message buttons.
     * Keep the existing empty state element.
     */
    el.inboxList
      .querySelectorAll(
        '.msg-item'
      )
      .forEach((node) => {
        node.remove();
      });

    renderInboxSkeleton(false);

    if (el.inboxCount) {
      el.inboxCount.textContent =
        String(
          state.messages.length
        );
    }

    if (!state.messages.length) {
      el.inboxEmpty?.classList.remove(
        'hidden'
      );

      return;
    }

    el.inboxEmpty?.classList.add(
      'hidden'
    );

    const sorted =
      [...state.messages].sort(
        (a, b) =>
          new Date(b.createdAt) -
          new Date(a.createdAt)
      );

    sorted.forEach((msg) => {
      const isActive =
        msg.id ===
        state.activeMessageId;

      const isUnread =
        msg.seen === false;

      const btn =
        document.createElement('button');

      btn.type = 'button';

      /*
       * IMPORTANT:
       * This keeps the existing CSS class.
       * No visual redesign.
       */
      btn.className =
        `msg-item block${
          isActive
            ? ' active'
            : ''
        }`;

      btn.dataset.id =
        msg.id;

      btn.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <span class="text-sm font-medium text-ink-100 truncate">
            ${escapeHtml(
              senderLabel(msg.from)
            )}
          </span>

          <span class="shrink-0 flex items-center gap-1.5">
            ${
              isUnread
                ? '<span class="badge-new">New</span>'
                : ''
            }

            <span class="text-[11px] text-ink-500 font-mono whitespace-nowrap">
              ${escapeHtml(
                formatDate(
                  msg.createdAt
                )
              )}
            </span>
          </span>
        </div>

        <p class="text-sm text-ink-300 mt-0.5 truncate">
          ${escapeHtml(
            msg.subject ||
              '(no subject)'
          )}
        </p>

        <p class="msg-snippet text-xs text-ink-500 mt-0.5">
          ${escapeHtml(
            msg.intro || ''
          )}
        </p>
      `;

      btn.addEventListener(
        'click',
        () => {
          openMessage(
            msg.id
          );
        }
      );

      el.inboxList.appendChild(
        btn
      );
    });
  }

  // ------------------------------------------------------------------------
  // Rendering — message viewer
  // ------------------------------------------------------------------------

  function resetViewer() {
    state.activeMessageId =
      null;

    el.viewerContent?.classList.add(
      'hidden'
    );

    el.viewerContent?.classList.remove(
      'mobile-open'
    );

    el.viewerEmpty?.classList.remove(
      'hidden'
    );

    if (el.viewerFrame) {
      el.viewerFrame.srcdoc =
        '';
    }

    if (el.viewerAttachments) {
      el.viewerAttachments.innerHTML =
        '';

      el.viewerAttachments.classList.add(
        'hidden'
      );
    }
  }

  async function openMessage(id) {
    state.activeMessageId =
      id;

    /*
     * Immediately update the active message
     * styling.
     */
    renderInbox();

    el.viewerEmpty?.classList.add(
      'hidden'
    );

    el.viewerContent?.classList.remove(
      'hidden'
    );

    /*
     * This class is already used by the existing
     * mobile CSS.
     */
    el.viewerContent?.classList.add(
      'mobile-open'
    );

    el.viewerSubject.textContent =
      'Loading…';

    el.viewerFrom.textContent =
      '';

    el.viewerDate.textContent =
      '';

    el.viewerFrame.srcdoc =
      '<div style="font-family:sans-serif;padding:24px;color:#94A3B5">Loading message…</div>';

    el.viewerAttachments.classList.add(
      'hidden'
    );

    el.viewerAttachments.innerHTML =
      '';

    try {
      const msg =
        await fetchMessageDetail(id);

      /*
       * Optimistically mark the message as seen
       * locally.
       */
      const cached =
        state.messages.find(
          (m) => m.id === id
        );

      if (cached) {
        cached.seen = true;
      }

      /*
       * Tell Mail.tm it has been read.
       */
      markMessageSeen(id);

      renderInbox();

      /*
       * User may have opened another message
       * while this request was loading.
       */
      if (
        state.activeMessageId !== id
      ) {
        return;
      }

      el.viewerSubject.textContent =
        msg.subject ||
        '(no subject)';

      el.viewerFrom.textContent =
        `${senderLabel(msg.from)}${
          msg.from?.address
            ? ` <${msg.from.address}>`
            : ''
        }`;

      el.viewerDate.textContent =
        formatDate(
          msg.createdAt
        );

      // --------------------------------------------------
      // Message body
      // --------------------------------------------------

      let html = '';

      if (
        msg.html &&
        msg.html.length
      ) {
        html =
          Array.isArray(msg.html)
            ? msg.html.join('')
            : msg.html;
      } else {
        const text =
          msg.text ||
          '(This message has no readable content.)';

        html = `
          <pre style="
            white-space:pre-wrap;
            word-break:break-word;
            font-family:ui-monospace,monospace;
            font-size:13px;
            line-height:1.6;
            margin:0;
          ">${escapeHtml(
            text
          )}</pre>
        `;
      }

      /*
       * The message is displayed inside the existing
       * iframe. This does not alter your page styling.
       */
      const wrapped = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">

          <base target="_blank">

          <style>
            html,body{
              margin:0;
              padding:16px;
              font-family:
                -apple-system,
                BlinkMacSystemFont,
                'Segoe UI',
                sans-serif;
              color:#111;
              background:#fff;
              word-wrap:break-word;
            }

            img{
              max-width:100%;
              height:auto;
            }

            a{
              color:#0b6b4d;
            }

            table{
              max-width:100%;
            }
          </style>
        </head>

        <body>
          ${html}
        </body>
        </html>
      `;

      el.viewerFrame.srcdoc =
        wrapped;

      // --------------------------------------------------
      // Attachments
      // --------------------------------------------------

      const attachments =
        msg.attachments || [];

      if (attachments.length) {
        el.viewerAttachments.classList.remove(
          'hidden'
        );

        attachments.forEach(
          (att) => {
            const chip =
              document.createElement(
                'button'
              );

            chip.type =
              'button';

            /*
             * Keep the existing attachment
             * styling class.
             */
            chip.className =
              'attachment-chip';

            chip.innerHTML = `
              <i
                data-lucide="paperclip"
                style="width:13px;height:13px"
              ></i>

              <span>
                ${escapeHtml(
                  att.filename ||
                    'attachment'
                )}
              </span>

              <span class="text-ink-500">
                ${escapeHtml(
                  formatBytes(
                    att.size
                  )
                )}
              </span>
            `;

            chip.addEventListener(
              'click',
              async () => {
                chip.disabled =
                  true;

                const original =
                  chip.innerHTML;

                chip.innerHTML = `
                  <i
                    data-lucide="loader-2"
                    class="animate-spin"
                    style="width:13px;height:13px"
                  ></i>

                  <span>
                    Downloading…
                  </span>
                `;

                renderIcons();

                try {
                  await downloadAttachment(
                    att.downloadUrl,
                    att.filename
                  );
                } catch (err) {
                  showToast(
                    err.message ||
                      'Download failed.',
                    'error'
                  );
                } finally {
                  chip.disabled =
                    false;

                  chip.innerHTML =
                    original;

                  renderIcons();
                }
              }
            );

            el.viewerAttachments.appendChild(
              chip
            );
          }
        );
      }

      renderIcons();
    } catch (err) {
      if (
        state.activeMessageId !== id
      ) {
        return;
      }

      el.viewerSubject.textContent =
        'Could not load this message';

      el.viewerFrame.srcdoc =
        `
          <div style="
            font-family:sans-serif;
            padding:24px;
            color:#b91c1c
          ">
            ${escapeHtml(
              err.message ||
                'Something went wrong.'
            )}
          </div>
        `;

      showToast(
        err.message ||
          'Could not load this message.',
        'error'
      );
    }
  }

  // ------------------------------------------------------------------------
  // Actions — inbox refresh
  // ------------------------------------------------------------------------

  async function refreshMessages(
    {
      silent = false,
    } = {}
  ) {
    if (
      !state.account ||
      state.isFetchingList
    ) {
      return;
    }

    state.isFetchingList =
      true;

    if (!silent) {
      spin(
        el.btnRefresh,
        true
      );
    }

    try {
      const list =
        await fetchMessageList();

      const previousIds =
        new Set(
          state.messages.map(
            (m) => m.id
          )
        );

      const arrivedNew =
        list.some(
          (m) =>
            !previousIds.has(
              m.id
            )
        );

      /*
       * Preserve local seen state.
       *
       * This prevents the UI from briefly showing
       * "New" again while Mail.tm catches up with
       * the PATCH request.
       */
      const seenOverrides =
        new Map(
          state.messages
            .filter(
              (m) => m.seen
            )
            .map(
              (m) => [
                m.id,
                true,
              ]
            )
        );

      list.forEach(
        (m) => {
          if (
            seenOverrides.has(
              m.id
            )
          ) {
            m.seen = true;
          }
        }
      );

      state.messages =
        list;

      renderInbox();

      /*
       * Don't announce the initial inbox load.
       */
      if (
        arrivedNew &&
        previousIds.size > 0
      ) {
        showToast(
          'New mail just arrived.'
        );
      }
    } catch (err) {
      /*
       * Silent polling failures shouldn't
       * repeatedly throw notifications at the user.
       */
      if (!silent) {
        showToast(
          err.message ||
            'Could not refresh the inbox.',
          'error'
        );
      }
    } finally {
      state.isFetchingList =
        false;

      if (!silent) {
        spin(
          el.btnRefresh,
          false
        );
      }
    }
  }

  // ------------------------------------------------------------------------
  // Actions — copy
  // ------------------------------------------------------------------------

  async function handleCopy() {
    if (!state.account) {
      return;
    }

    try {
      /*
       * Modern Clipboard API.
       */
      await navigator.clipboard.writeText(
        state.account.address
      );
    } catch {
      /*
       * Fallback for browsers/contexts where
       * navigator.clipboard isn't available.
       */
      const ta =
        document.createElement(
          'textarea'
        );

      ta.value =
        state.account.address;

      ta.style.position =
        'fixed';

      ta.style.opacity =
        '0';

      document.body.appendChild(
        ta
      );

      ta.select();

      try {
        document.execCommand(
          'copy'
        );
      } catch {
        // Ignore fallback failure.
      }

      ta.remove();
    }

    el.copyTooltip.classList.add(
      'show'
    );

    el.addressBox.classList.add(
      'flash-copied'
    );

    setTimeout(() => {
      el.copyTooltip.classList.remove(
        'show'
      );

      el.addressBox.classList.remove(
        'flash-copied'
      );
    }, 1500);
  }

  // ------------------------------------------------------------------------
  // Actions — new random address
  // ------------------------------------------------------------------------

  async function handleNewRandomAddress() {
    if (state.isBusy) {
      return;
    }

    setBusy(true);

    spin(
      el.btnRandom,
      true
    );

    setAddressLoading(true);

    el.addressText.textContent =
      'generating…';

    try {
      const account =
        await provisionRandomAccount();

      await activateAccount(
        account
      );
    } catch (err) {
      showToast(
        err.message ||
          'Could not generate a new address.',
        'error'
      );

      /*
       * Keep the old address visible if generation
       * failed.
       */
      el.addressText.textContent =
        state.account?.address ||
        'unavailable';

      setAddressLoading(false);
    } finally {
      setBusy(false);

      spin(
        el.btnRandom,
        false
      );
    }
  }

  // ------------------------------------------------------------------------
  // Actions — custom address
  // ------------------------------------------------------------------------

  async function handleCreateCustom() {
    if (state.isBusy) {
      return;
    }

    const prefix =
      el.inputPrefix.value;

    const domain =
      el.selectDomain.value;

    setBusy(true);

    spin(
      el.btnCreateCustom,
      true
    );

    try {
      const account =
        await provisionCustomAccount(
          prefix,
          domain
        );

      await activateAccount(
        account
      );

      el.inputPrefix.value =
        '';
    } catch (err) {
      showToast(
        err.message ||
          'Could not create that address. It may already be taken.',
        'error'
      );
    } finally {
      setBusy(false);

      spin(
        el.btnCreateCustom,
        false
      );
    }
  }

  // ------------------------------------------------------------------------
  // Actions — delete / replace
  // ------------------------------------------------------------------------

  async function handleDelete() {
    if (
      state.isBusy ||
      !state.account
    ) {
      return;
    }

    setBusy(true);

    spin(
      el.btnDelete,
      true
    );

    const oldAccount =
      state.account;

    try {
      /*
       * IMPORTANT:
       *
       * Create the replacement FIRST.
       *
       * This prevents a failed account creation/rate-limit
       * from leaving the user without an inbox.
       */
      showToast(
        'Provisioning a new address…'
      );

      const replacement =
        await provisionRandomAccount();

      /*
       * Switch to the replacement.
       */
      await activateAccount(
        replacement,
        {
          announce: false,
        }
      );

      /*
       * Now delete the old account.
       */
      try {
        await deleteAccountRemote(
          oldAccount.id
        );
      } catch {
        /*
         * The old account may already have expired.
         *
         * The new account is still valid, so don't
         * interrupt the user.
         */
      }

      showToast(
        'Old address deleted — new one is ready.'
      );
    } catch (err) {
      /*
       * If replacement creation fails, leave the
       * existing account alone.
       */
      if (
        state.account?.id ===
        oldAccount.id
      ) {
        startPolling();
      }

      showToast(
        err.message ||
          'Could not create a replacement address.',
        'error'
      );
    } finally {
      setBusy(false);

      spin(
        el.btnDelete,
        false
      );
    }
  }

  // ------------------------------------------------------------------------
  // Actions — manual refresh
  // ------------------------------------------------------------------------

  async function handleManualRefresh() {
    state.msRemaining =
      POLL_MS;

    await refreshMessages({
      silent: false,
    });
  }

  // ------------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------------

  function bindEvents() {
    if (el.btnCopy) {
      el.btnCopy.addEventListener(
        'click',
        handleCopy
      );
    }

    if (el.btnRefresh) {
      el.btnRefresh.addEventListener(
        'click',
        handleManualRefresh
      );
    }

    if (el.btnRandom) {
      el.btnRandom.addEventListener(
        'click',
        handleNewRandomAddress
      );
    }

    if (el.btnDelete) {
      el.btnDelete.addEventListener(
        'click',
        () => {
          if (
            confirm(
              'Delete this address? Any mail in it will be gone for good.'
            )
          ) {
            handleDelete();
          }
        }
      );
    }

    if (el.btnCreateCustom) {
      el.btnCreateCustom.addEventListener(
        'click',
        handleCreateCustom
      );
    }

    if (el.inputPrefix) {
      el.inputPrefix.addEventListener(
        'keydown',
        (e) => {
          if (e.key === 'Enter') {
            handleCreateCustom();
          }
        }
      );
    }

    if (el.btnCloseViewer) {
      el.btnCloseViewer.addEventListener(
        'click',
        () => {
          el.viewerContent.classList.remove(
            'mobile-open'
          );

          el.viewerContent.classList.add(
            'hidden'
          );

          el.viewerEmpty.classList.remove(
            'hidden'
          );

          state.activeMessageId =
            null;

          renderInbox();
        }
      );
    }

    /*
     * When the user comes back to the tab,
     * immediately check for new mail.
     */
    document.addEventListener(
      'visibilitychange',
      () => {
        if (
          document.visibilityState ===
            'visible' &&
          state.account
        ) {
          refreshMessages({
            silent: true,
          });
        }
      }
    );
  }

  // ------------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------------

  async function boot() {
    renderIcons();

    bindEvents();

    setAddressLoading(true);

    renderInboxSkeleton(true);

    /*
     * Load the available Mail.tm domains first.
     */
    const domainsReady =
      await initDomains();

    if (!domainsReady) {
      setAddressLoading(false);

      el.addressText.textContent =
        'unavailable';

      renderInboxSkeleton(false);

      return;
    }

    /*
     * Try to restore an existing inbox before
     * creating a new one.
     */
    const restored =
      await tryRestoreAccount();

    if (restored) {
      await activateAccount(
        state.account,
        {
          announce: false,
        }
      );

      showToast(
        'Welcome back — restored your last address.'
      );

      return;
    }

    /*
     * No valid existing session.
     *
     * Create a new random inbox.
     */
    try {
      const account =
        await provisionRandomAccount();

      await activateAccount(
        account,
        {
          announce: false,
        }
      );
    } catch (err) {
      setAddressLoading(false);

      el.addressText.textContent =
        'unavailable';

      renderInboxSkeleton(false);

      showToast(
        err.message ||
          'Could not reach Mail.tm to create an address.',
        'error'
      );
    }
  }

  document.addEventListener(
    'DOMContentLoaded',
    boot
  );

})();