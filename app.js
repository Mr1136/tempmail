/* ==========================================================================
   Vanish — TempMailPortal integration
   Polished email viewer + secure sandboxed email rendering
   ========================================================================== */

(() => {
  'use strict';

  // ------------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------------

  const API_BASE = 'https://api.tempmailportal.com';
  const POLL_MS = 9000;
  const STORAGE_KEY = 'vanish.tempmailportal.v1';

  const state = {
    domains: [],
    account: null,
    messages: [],
    activeMessageId: null,

    pollTimer: null,
    countdownTimer: null,
    msRemaining: POLL_MS,

    isFetchingList: false,
    isBusy: false,
  };

  // ------------------------------------------------------------------------
  // DOM
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
  // Icons
  // ------------------------------------------------------------------------

  function renderIcons() {
    if (
      window.lucide &&
      typeof window.lucide.createIcons === 'function'
    ) {
      window.lucide.createIcons();
    }
  }

  // ------------------------------------------------------------------------
  // Toast
  // ------------------------------------------------------------------------

  function showToast(message, type = 'info') {
    if (!el.toast || !el.toastText) return;

    el.toastText.textContent = message;

    el.toast.classList.remove('hidden');
    el.toast.classList.add('flex');

    const icon = el.toast.querySelector('i');

    if (icon) {
      icon.setAttribute(
        'data-lucide',
        type === 'error'
          ? 'alert-triangle'
          : 'info'
      );

      renderIcons();
    }

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      el.toast.classList.add('hidden');
      el.toast.classList.remove('flex');
    }, 3200);
  }

  // ------------------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------------------

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  function formatDate(dateString) {
    if (!dateString) return '';

    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const now = new Date();

    const sameDay =
      date.toDateString() === now.toDateString();

    const time = date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });

    if (sameDay) {
      return `Today, ${time}`;
    }

    return (
      date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }) +
      ` · ${time}`
    );
  }

  function setBusy(busy) {
    state.isBusy = busy;

    [
      el.btnCopy,
      el.btnRefresh,
      el.btnRandom,
      el.btnDelete,
      el.btnCreateCustom,
    ].forEach((button) => {
      if (!button) return;

      button.disabled = busy;

      button.classList.toggle('opacity-50', busy);
      button.classList.toggle(
        'cursor-not-allowed',
        busy
      );
    });
  }

  function spin(button, spinning) {
    if (!button) return;

    const icon = button.querySelector('i');

    if (!icon) return;

    icon.classList.toggle(
      'animate-spin',
      spinning
    );
  }

  function setAddressLoading(loading) {
    if (el.addressSkeleton) {
      el.addressSkeleton.classList.toggle(
        'hidden',
        !loading
      );
    }

    if (el.addressCursor) {
      el.addressCursor.classList.toggle(
        'hidden',
        loading
      );
    }
  }

  // ------------------------------------------------------------------------
  // API
  // ------------------------------------------------------------------------

  async function apiRequest(path, options = {}) {
    const {
      method = 'GET',
      body,
      auth = false,
      timeoutMs = 15000,
    } = options;

    const headers = {
      Accept: 'application/json',
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (auth) {
      if (!state.account?.token) {
        throw new Error(
          'Your inbox session is missing.'
        );
      }

      headers.Authorization =
        `Bearer ${state.account.token}`;
    }

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let response;

    try {
      response = await fetch(
        `${API_BASE}${path}`,
        {
          method,
          headers,
          body:
            body !== undefined
              ? JSON.stringify(body)
              : undefined,
          signal: controller.signal,
        }
      );
    } catch (error) {
      clearTimeout(timeout);

      if (error.name === 'AbortError') {
        throw new Error(
          'The request timed out.'
        );
      }

      throw new Error(
        'Could not connect to the temporary-mail service.'
      );
    }

    clearTimeout(timeout);

    const text = await response.text();

    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      if (response.status === 429) {
        const retry =
          response.headers.get('Retry-After');

        throw new Error(
          retry
            ? `Too many requests. Please wait ${retry} seconds.`
            : 'Too many requests. Please wait a little while.'
        );
      }

      throw new Error(
        data?.error ||
          `Request failed (${response.status}).`
      );
    }

    return data;
  }

  // ------------------------------------------------------------------------
  // Domains
  // ------------------------------------------------------------------------

  async function fetchDomains() {
    const data = await apiRequest('/api/domains');

    if (!Array.isArray(data)) {
      throw new Error(
        'The temporary-mail service returned an invalid domain list.'
      );
    }

    return data.filter(
      (domain) =>
        typeof domain === 'string' &&
        domain.length > 0
    );
  }

  async function loadDomains() {
    try {
      state.domains = await fetchDomains();

      if (!state.domains.length) {
        throw new Error(
          'No temporary-mail domains are currently available.'
        );
      }

      if (el.selectDomain) {
        el.selectDomain.innerHTML = '';

        state.domains.forEach((domain) => {
          const option =
            document.createElement('option');

          option.value = domain;
          option.textContent = `@${domain}`;

          el.selectDomain.appendChild(option);
        });
      }

      return true;
    } catch (error) {
      if (el.selectDomain) {
        el.selectDomain.innerHTML =
          '<option>unavailable</option>';
      }

      showToast(
        error.message ||
          'Could not load email domains.',
        'error'
      );

      return false;
    }
  }

  // ------------------------------------------------------------------------
  // Inbox creation
  // ------------------------------------------------------------------------

  async function createInbox(options = {}) {
    const data = await apiRequest(
      '/api/inbox',
      {
        method: 'POST',
        body:
          Object.keys(options).length
            ? options
            : undefined,
      }
    );

    if (!data?.address || !data?.token) {
      throw new Error(
        'The temporary-mail service did not return a valid inbox.'
      );
    }

    return {
      address: data.address,
      token: data.token,
    };
  }

  async function createRandomInbox() {
    return createInbox();
  }

  async function createCustomInbox(
    login,
    domain
  ) {
    const cleanLogin = String(login || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 30);

    if (!cleanLogin) {
      throw new Error(
        'Enter a valid username.'
      );
    }

    if (!domain) {
      throw new Error(
        'Choose an email domain.'
      );
    }

    return createInbox({
      login: cleanLogin,
      domain,
    });
  }

  // ------------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------------

  function saveAccount() {
    if (!state.account) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state.account)
    );
  }

  function loadAccount() {
    try {
      const saved =
        localStorage.getItem(STORAGE_KEY);

      if (!saved) return null;

      const account = JSON.parse(saved);

      if (
        !account?.address ||
        !account?.token
      ) {
        return null;
      }

      return account;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------------
  // Message API
  // ------------------------------------------------------------------------

  async function fetchMessages() {
    return apiRequest('/api/messages', {
      auth: true,
    });
  }

  async function fetchMessage(id) {
    return apiRequest(
      `/api/messages/${encodeURIComponent(id)}`,
      {
        auth: true,
      }
    );
  }

  async function deleteInbox() {
    return apiRequest('/api/inbox', {
      method: 'DELETE',
      auth: true,
    });
  }

  // ------------------------------------------------------------------------
  // Inbox rendering
  // ------------------------------------------------------------------------

  function renderInbox() {
    if (!el.inboxList) return;

    el.inboxList
      .querySelectorAll('.msg-item')
      .forEach((node) => node.remove());

    const messages = [...state.messages];

    if (el.inboxCount) {
      el.inboxCount.textContent =
        String(messages.length);
    }

    if (!messages.length) {
      el.inboxEmpty?.classList.remove('hidden');
      return;
    }

    el.inboxEmpty?.classList.add('hidden');

    messages.forEach((message) => {
      const button =
        document.createElement('button');

      button.type = 'button';

      button.className =
        `msg-item block${
          message.id === state.activeMessageId
            ? ' active'
            : ''
        }`;

      button.dataset.id = message.id;

      const sender =
        message.fromName ||
        message.from ||
        'Unknown sender';

      button.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <span class="text-sm font-medium text-ink-100 truncate">
            ${escapeHtml(sender)}
          </span>

          <span class="text-[11px] text-ink-500 font-mono whitespace-nowrap">
            ${escapeHtml(
              formatDate(message.date)
            )}
          </span>
        </div>

        <p class="text-sm text-ink-300 mt-0.5 truncate">
          ${escapeHtml(
            message.subject || '(no subject)'
          )}
        </p>

        <p class="msg-snippet text-xs text-ink-500 mt-0.5">
          ${escapeHtml(message.intro || '')}
        </p>
      `;

      button.addEventListener('click', () => {
        openMessage(message.id);
      });

      el.inboxList.appendChild(button);
    });
  }

  // ------------------------------------------------------------------------
  // Viewer reset
  // ------------------------------------------------------------------------

  function resetViewer() {
    state.activeMessageId = null;

    el.viewerContent?.classList.add('hidden');

    el.viewerContent?.classList.remove(
      'mobile-open'
    );

    el.viewerEmpty?.classList.remove(
      'hidden'
    );

    if (el.viewerFrame) {
      el.viewerFrame.srcdoc = '';
    }

    if (el.viewerAttachments) {
      el.viewerAttachments.innerHTML = '';

      el.viewerAttachments.classList.add(
        'hidden'
      );
    }
  }

  // ------------------------------------------------------------------------
  // EMAIL SANITISATION
  // ------------------------------------------------------------------------

  function sanitiseEmailHtml(html) {
    if (!html) return '';

    const parser =
      new DOMParser();

    const document =
      parser.parseFromString(
        html,
        'text/html'
      );

    /*
     * Remove anything that could execute
     * JavaScript or manipulate the parent page.
     */

    document
      .querySelectorAll(
        'script, noscript, object, embed, applet, form, base, meta, link'
      )
      .forEach((node) => node.remove());

    /*
     * Remove event-handler attributes:
     *
     * onclick
     * onload
     * onerror
     * etc.
     */

    document
      .querySelectorAll('*')
      .forEach((node) => {
        [...node.attributes].forEach(
          (attribute) => {
            if (
              attribute.name
                .toLowerCase()
                .startsWith('on')
            ) {
              node.removeAttribute(
                attribute.name
              );
            }
          }
        );
      });

    /*
     * Prevent javascript: URLs.
     */

    document
      .querySelectorAll(
        'a[href], img[src], iframe[src]'
      )
      .forEach((node) => {
        const attribute =
          node.hasAttribute('href')
            ? 'href'
            : 'src';

        const value =
          node.getAttribute(attribute);

        if (
          value &&
          /^\s*javascript:/i.test(value)
        ) {
          node.removeAttribute(attribute);
        }
      });

    /*
     * Email images are allowed, but the iframe itself
     * remains sandboxed and cannot access the parent page.
     */

    return document.body.innerHTML;
  }

  // ------------------------------------------------------------------------
  // POLISHED EMAIL DOCUMENT
  // ------------------------------------------------------------------------

  function buildSafeMessageDocument(
    html,
    text
  ) {
    const safeHtml =
      sanitiseEmailHtml(html);

    const content =
      safeHtml.trim()
        ? safeHtml
        : `
          <div class="plain-text">
            ${escapeHtml(
              text ||
                '(This message has no readable content.)'
            )}
          </div>
        `;

    return `
      <!doctype html>

      <html lang="en">

      <head>

        <meta charset="utf-8">

        <meta
          name="viewport"
          content="width=device-width,initial-scale=1"
        >

        <style>

          :root {
            color-scheme: light;
          }

          * {
            box-sizing: border-box;
          }

          html,
          body {
            margin: 0;
            padding: 0;
            width: 100%;
            min-height: 100%;
          }

          body {
            background: #f4f7f6;
            color: #18211d;

            font-family:
              Inter,
              -apple-system,
              BlinkMacSystemFont,
              "Segoe UI",
              sans-serif;

            font-size: 14px;
            line-height: 1.65;

            padding: 24px 18px 40px;

            word-wrap: break-word;
            overflow-wrap: anywhere;
          }

          .email-shell {
            width: 100%;
            max-width: 760px;
            margin: 0 auto;

            background: #ffffff;

            border: 1px solid #e1e7e4;

            border-radius: 14px;

            box-shadow:
              0 1px 2px rgba(15, 23, 42, 0.04),
              0 10px 30px rgba(15, 23, 42, 0.06);

            overflow: hidden;
          }

          .email-content {
            padding: 28px 30px;
          }

          .email-content > :first-child {
            margin-top: 0;
          }

          .email-content > :last-child {
            margin-bottom: 0;
          }

          p {
            margin: 0 0 1em;
          }

          h1,
          h2,
          h3,
          h4,
          h5,
          h6 {
            color: #17221d;
            line-height: 1.3;
            margin-top: 1.4em;
            margin-bottom: 0.55em;
          }

          h1 {
            font-size: 26px;
          }

          h2 {
            font-size: 21px;
          }

          h3 {
            font-size: 18px;
          }

          a {
            color: #16835a;
            text-decoration: underline;
            text-decoration-thickness: 1px;
            text-underline-offset: 2px;
          }

          a:hover {
            color: #0d6545;
          }

          img {
            display: block;
            max-width: 100%;
            height: auto;
            border: 0;
          }

          table {
            max-width: 100%;
            border-collapse: collapse;
          }

          td,
          th {
            max-width: 100%;
          }

          blockquote {
            margin: 18px 0;
            padding: 12px 18px;

            border-left:
              3px solid #37e29a;

            background: #f4f8f6;

            color: #52615a;
          }

          pre {
            white-space: pre-wrap;
            overflow-x: auto;

            padding: 14px;

            border-radius: 10px;

            background: #f1f4f3;

            border: 1px solid #e1e7e4;

            font-family:
              "JetBrains Mono",
              ui-monospace,
              SFMono-Regular,
              Menlo,
              monospace;

            font-size: 12px;
            line-height: 1.6;
          }

          code {
            font-family:
              "JetBrains Mono",
              ui-monospace,
              SFMono-Regular,
              Menlo,
              monospace;

            font-size: 0.92em;

            background: #f1f4f3;

            border-radius: 5px;

            padding: 2px 5px;
          }

          hr {
            border: 0;
            border-top: 1px solid #e5e9e7;
            margin: 24px 0;
          }

          .plain-text {
            white-space: pre-wrap;
            word-break: break-word;

            font-family:
              "JetBrains Mono",
              ui-monospace,
              SFMono-Regular,
              Menlo,
              monospace;

            font-size: 13px;
            line-height: 1.7;

            color: #35423c;
          }

          @media (max-width: 640px) {

            body {
              padding:
                12px 8px 28px;
            }

            .email-content {
              padding:
                20px 18px;
            }

            .email-shell {
              border-radius: 10px;
            }

            h1 {
              font-size: 22px;
            }

            h2 {
              font-size: 19px;
            }

          }

        </style>

      </head>

      <body>

        <article class="email-shell">

          <div class="email-content">

            ${content}

          </div>

        </article>

      </body>

      </html>
    `;
  }

  // ------------------------------------------------------------------------
  // Open message
  // ------------------------------------------------------------------------

  async function openMessage(id) {
    state.activeMessageId = id;

    renderInbox();

    el.viewerEmpty?.classList.add('hidden');

    el.viewerContent?.classList.remove(
      'hidden'
    );

    el.viewerContent?.classList.add(
      'mobile-open'
    );

    el.viewerSubject.textContent =
      'Loading…';

    el.viewerFrom.textContent = '';
    el.viewerDate.textContent = '';

    el.viewerAttachments.innerHTML = '';

    el.viewerAttachments.classList.add(
      'hidden'
    );

    /*
     * IMPORTANT:
     *
     * Keep the iframe completely sandboxed.
     *
     * No allow-scripts.
     * No allow-forms.
     * No allow-top-navigation.
     */

    el.viewerFrame.setAttribute(
      'sandbox',
      ''
    );

    el.viewerFrame.srcdoc = `
      <!doctype html>

      <html>

        <body style="
          margin:0;
          padding:30px;
          background:#f4f7f6;
          font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          color:#718078;
        ">

          Loading message…

        </body>

      </html>
    `;

    try {
      const message =
        await fetchMessage(id);

      if (
        state.activeMessageId !== id
      ) {
        return;
      }

      el.viewerSubject.textContent =
        message.subject ||
        '(no subject)';

      el.viewerFrom.textContent =
        message.fromName
          ? `${message.fromName} <${message.from}>`
          : message.from ||
            'Unknown sender';

      el.viewerDate.textContent =
        formatDate(message.date);

      const html =
        Array.isArray(message.html)
          ? message.html.join('')
          : message.html;

      el.viewerFrame.srcdoc =
        buildSafeMessageDocument(
          html,
          message.text
        );

      renderAttachments(
        message.attachments || []
      );

      renderIcons();

    } catch (error) {

      el.viewerSubject.textContent =
        'Could not load this message';

      el.viewerFrame.srcdoc = `
        <!doctype html>

        <html>

          <body style="
            margin:0;
            padding:30px;
            background:#f4f7f6;
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
            color:#b91c1c;
          ">

            ${escapeHtml(
              error.message ||
                'Something went wrong.'
            )}

          </body>

        </html>
      `;

      showToast(
        error.message ||
          'Could not load this message.',
        'error'
      );
    }
  }

  // ------------------------------------------------------------------------
  // Attachments
  // ------------------------------------------------------------------------

  function renderAttachments(attachments) {
    if (!el.viewerAttachments) return;

    el.viewerAttachments.innerHTML = '';

    if (!attachments.length) {
      el.viewerAttachments.classList.add(
        'hidden'
      );

      return;
    }

    el.viewerAttachments.classList.remove(
      'hidden'
    );

    attachments.forEach((attachment) => {
      const item =
        document.createElement('div');

      const downloadable =
        attachment.downloadable === true;

      item.className =
        'attachment-chip';

      item.innerHTML = `
        <i
          data-lucide="paperclip"
          style="width:13px;height:13px"
        ></i>

        <span>
          ${escapeHtml(
            attachment.filename ||
              'attachment'
          )}
        </span>

        <span class="text-ink-500">
          ${
            downloadable
              ? 'available'
              : 'not downloadable'
          }
        </span>
      `;

      el.viewerAttachments.appendChild(item);
    });

    renderIcons();
  }

  // ------------------------------------------------------------------------
  // Refresh inbox
  // ------------------------------------------------------------------------

  async function refreshMessages({
    silent = false,
  } = {}) {
    if (
      !state.account ||
      state.isFetchingList
    ) {
      return;
    }

    state.isFetchingList = true;

    if (!silent) {
      spin(el.btnRefresh, true);
    }

    try {
      const messages =
        await fetchMessages();

      if (!Array.isArray(messages)) {
        throw new Error(
          'The inbox returned an invalid response.'
        );
      }

      const previousIds =
        new Set(
          state.messages.map(
            (message) => message.id
          )
        );

      const hasNewMail =
        messages.some(
          (message) =>
            !previousIds.has(
              message.id
            )
        );

      state.messages = messages;

      renderInbox();

      if (
        hasNewMail &&
        previousIds.size > 0
      ) {
        showToast(
          'New mail just arrived.'
        );
      }

    } catch (error) {

      if (!silent) {
        showToast(
          error.message ||
            'Could not refresh the inbox.',
          'error'
        );
      }

    } finally {

      state.isFetchingList = false;

      if (!silent) {
        spin(el.btnRefresh, false);
      }
    }
  }

  // ------------------------------------------------------------------------
  // Polling
  // ------------------------------------------------------------------------

  function stopPolling() {
    clearInterval(state.pollTimer);
    clearInterval(state.countdownTimer);

    state.pollTimer = null;
    state.countdownTimer = null;
  }

  function startPolling() {
    stopPolling();

    state.msRemaining = POLL_MS;

    state.pollTimer =
      setInterval(() => {

        state.msRemaining =
          POLL_MS;

        refreshMessages({
          silent: true,
        });

      }, POLL_MS);

    state.countdownTimer =
      setInterval(() => {

        state.msRemaining =
          Math.max(
            0,
            state.msRemaining - 100
          );

        const percentage =
          100 -
          (
            state.msRemaining /
            POLL_MS
          ) *
            100;

        if (el.pollBar) {
          el.pollBar.style.width =
            `${percentage}%`;
        }

        if (el.pollLabel) {
          el.pollLabel.textContent =
            `next check ${Math.ceil(
              state.msRemaining /
                1000
            )}s`;
        }

      }, 100);
  }

  // ------------------------------------------------------------------------
  // Activate inbox
  // ------------------------------------------------------------------------

  async function activateInbox(
    account,
    announce = true
  ) {
    stopPolling();

    state.account = account;
    state.messages = [];
    state.activeMessageId = null;

    saveAccount();

    el.addressText.textContent =
      account.address;

    setAddressLoading(false);

    if (el.expiryNote) {
      el.expiryNote.textContent =
        'Messages expire after about 24 hours';
    }

    resetViewer();

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
  // Copy
  // ------------------------------------------------------------------------

  async function copyAddress() {
    if (!state.account) return;

    const address =
      state.account.address;

    try {
      await navigator.clipboard.writeText(
        address
      );
    } catch {

      const textarea =
        document.createElement(
          'textarea'
        );

      textarea.value = address;

      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';

      document.body.appendChild(
        textarea
      );

      textarea.select();

      try {
        document.execCommand('copy');
      } catch {}

      textarea.remove();
    }

    if (el.copyTooltip) {
      el.copyTooltip.classList.add('show');

      setTimeout(() => {
        el.copyTooltip.classList.remove(
          'show'
        );
      }, 1500);
    }

    if (el.addressBox) {
      el.addressBox.classList.add(
        'flash-copied'
      );

      setTimeout(() => {
        el.addressBox.classList.remove(
          'flash-copied'
        );
      }, 1500);
    }
  }

  // ------------------------------------------------------------------------
  // Random address
  // ------------------------------------------------------------------------

  async function newRandomAddress() {
    if (state.isBusy) return;

    setBusy(true);

    spin(el.btnRandom, true);

    setAddressLoading(true);

    el.addressText.textContent =
      'generating…';

    try {

      const account =
        await createRandomInbox();

      await activateInbox(account);

    } catch (error) {

      el.addressText.textContent =
        state.account?.address ||
        'unavailable';

      setAddressLoading(false);

      showToast(
        error.message ||
          'Could not create an inbox.',
        'error'
      );

    } finally {

      setBusy(false);

      spin(el.btnRandom, false);
    }
  }

  // ------------------------------------------------------------------------
  // Custom address
  // ------------------------------------------------------------------------

  async function createCustomAddress() {
    if (state.isBusy) return;

    const login =
      el.inputPrefix?.value || '';

    const domain =
      el.selectDomain?.value || '';

    setBusy(true);

    spin(
      el.btnCreateCustom,
      true
    );

    try {

      const account =
        await createCustomInbox(
          login,
          domain
        );

      await activateInbox(account);

      if (el.inputPrefix) {
        el.inputPrefix.value = '';
      }

    } catch (error) {

      showToast(
        error.message ||
          'Could not create that address.',
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
  // Delete
  // ------------------------------------------------------------------------

  async function deleteCurrentInbox() {
    if (
      state.isBusy ||
      !state.account
    ) {
      return;
    }

    setBusy(true);

    spin(el.btnDelete, true);

    try {

      await deleteInbox();

      stopPolling();

      localStorage.removeItem(
        STORAGE_KEY
      );

      state.account = null;
      state.messages = [];
      state.activeMessageId = null;

      const replacement =
        await createRandomInbox();

      await activateInbox(
        replacement,
        false
      );

      showToast(
        'Inbox deleted — new address ready.'
      );

    } catch (error) {

      showToast(
        error.message ||
          'Could not replace this inbox.',
        'error'
      );

      if (state.account) {
        startPolling();
      }

    } finally {

      setBusy(false);

      spin(el.btnDelete, false);
    }
  }

  // ------------------------------------------------------------------------
  // Manual refresh
  // ------------------------------------------------------------------------

  async function manualRefresh() {
    state.msRemaining = POLL_MS;

    await refreshMessages({
      silent: false,
    });
  }

  // ------------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------------

  function bindEvents() {

    el.btnCopy?.addEventListener(
      'click',
      copyAddress
    );

    el.btnRefresh?.addEventListener(
      'click',
      manualRefresh
    );

    el.btnRandom?.addEventListener(
      'click',
      newRandomAddress
    );

    el.btnCreateCustom?.addEventListener(
      'click',
      createCustomAddress
    );

    el.inputPrefix?.addEventListener(
      'keydown',
      (event) => {

        if (event.key === 'Enter') {
          createCustomAddress();
        }

      }
    );

    el.btnDelete?.addEventListener(
      'click',
      () => {

        const confirmed =
          window.confirm(
            'Delete this inbox? All messages in it will be permanently removed.'
          );

        if (confirmed) {
          deleteCurrentInbox();
        }

      }
    );

    el.btnCloseViewer?.addEventListener(
      'click',
      () => {

        state.activeMessageId = null;

        el.viewerContent?.classList.remove(
          'mobile-open'
        );

        el.viewerContent?.classList.add(
          'hidden'
        );

        el.viewerEmpty?.classList.remove(
          'hidden'
        );

        renderInbox();
      }
    );

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

    /*
     * Load domains first.
     */

    const domainsReady =
      await loadDomains();

    if (!domainsReady) {

      setAddressLoading(false);

      el.addressText.textContent =
        'unavailable';

      return;
    }

    /*
     * Restore existing inbox.
     */

    const saved =
      loadAccount();

    if (saved) {

      try {

        await activateInbox(
          saved,
          false
        );

        showToast(
          'Welcome back — inbox restored.'
        );

        return;

      } catch {

        localStorage.removeItem(
          STORAGE_KEY
        );
      }
    }

    /*
     * Otherwise create a new inbox.
     */

    try {

      const account =
        await createRandomInbox();

      await activateInbox(
        account,
        false
      );

    } catch (error) {

      setAddressLoading(false);

      el.addressText.textContent =
        'unavailable';

      showToast(
        error.message ||
          'Could not create a temporary inbox.',
        'error'
      );
    }
  }

  document.addEventListener(
    'DOMContentLoaded',
    boot
  );

})();
