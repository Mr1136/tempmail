/* ==========================================================================
   Vanish — TempMailPortal API integration
   --------------------------------------------------------------------------
   Complete application controller.

   Features:
   - Temporary inbox creation
   - Custom email addresses
   - Random email addresses
   - Persistent inbox sessions
   - Automatic polling
   - Email viewer
   - Mobile email viewer
   - Attachment display
   - Safe sandboxed HTML email rendering
   - Copy address
   - Delete / replace inbox
   ========================================================================== */

(() => {
  'use strict';

  // =========================================================================
  // CONFIGURATION
  // =========================================================================

  const API_BASE = 'https://api.tempmailportal.com';

  const POLL_MS = 9000;

  const STORAGE_KEY = 'vanish.tempmailportal.v1';

  // =========================================================================
  // STATE
  // =========================================================================

  const state = {
    domains: [],

    account: null,

    messages: [],

    activeMessageId: null,

    activeMessage: null,

    pollTimer: null,

    countdownTimer: null,

    msRemaining: POLL_MS,

    isFetchingList: false,

    isBusy: false,
  };

  // =========================================================================
  // DOM
  // =========================================================================

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

  // =========================================================================
  // ICONS
  // =========================================================================

  function renderIcons() {
    if (
      window.lucide &&
      typeof window.lucide.createIcons === 'function'
    ) {
      window.lucide.createIcons();
    }
  }

  // =========================================================================
  // TOAST
  // =========================================================================

  function showToast(message, type = 'info') {
    if (!el.toast || !el.toastText) {
      return;
    }

    el.toastText.textContent = message;

    el.toast.classList.remove('hidden');
    el.toast.classList.add('flex');

    const icon = el.toast.querySelector('i');

    if (icon) {
      icon.setAttribute(
        'data-lucide',
        type === 'error' ? 'alert-triangle' : 'info'
      );

      renderIcons();
    }

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      el.toast.classList.add('hidden');
      el.toast.classList.remove('flex');
    }, 3200);
  }

  // =========================================================================
  // HTML ESCAPING
  // =========================================================================

  function escapeHtml(value) {
    const div = document.createElement('div');

    div.textContent = value ?? '';

    return div.innerHTML;
  }

  // =========================================================================
  // DATE FORMATTING
  // =========================================================================

  function formatDate(dateString) {
    if (!dateString) {
      return '';
    }

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
        year:
          date.getFullYear() !== now.getFullYear()
            ? 'numeric'
            : undefined,
      }) + ` · ${time}`
    );
  }

  // =========================================================================
  // BUSY STATE
  // =========================================================================

  function setBusy(busy) {
    state.isBusy = busy;

    [
      el.btnCopy,
      el.btnRefresh,
      el.btnRandom,
      el.btnDelete,
      el.btnCreateCustom,
    ].forEach((button) => {
      if (!button) {
        return;
      }

      button.disabled = busy;

      button.classList.toggle('opacity-50', busy);

      button.classList.toggle(
        'cursor-not-allowed',
        busy
      );
    });
  }

  // =========================================================================
  // BUTTON SPINNER
  // =========================================================================

  function spin(button, spinning) {
    if (!button) {
      return;
    }

    const icon = button.querySelector('i');

    if (!icon) {
      return;
    }

    icon.classList.toggle(
      'animate-spin',
      spinning
    );
  }

  // =========================================================================
  // ADDRESS LOADING
  // =========================================================================

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

  // =========================================================================
  // API
  // =========================================================================

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

  // =========================================================================
  // DOMAINS
  // =========================================================================

  async function fetchDomains() {
    const data = await apiRequest(
      '/api/domains'
    );

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
      state.domains =
        await fetchDomains();

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

          option.textContent =
            `@${domain}`;

          el.selectDomain.appendChild(
            option
          );
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

  // =========================================================================
  // INBOX CREATION
  // =========================================================================

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

    if (
      !data?.address ||
      !data?.token
    ) {
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
    const cleanLogin = String(
      login || ''
    )
      .trim()
      .toLowerCase()
      .replace(
        /[^a-z0-9._-]/g,
        ''
      )
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

  // =========================================================================
  // STORAGE
  // =========================================================================

  function saveAccount() {
    if (!state.account) {
      localStorage.removeItem(
        STORAGE_KEY
      );

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
        localStorage.getItem(
          STORAGE_KEY
        );

      if (!saved) {
        return null;
      }

      const account =
        JSON.parse(saved);

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

  // =========================================================================
  // MESSAGE API
  // =========================================================================

  async function fetchMessages() {
    return apiRequest(
      '/api/messages',
      {
        auth: true,
      }
    );
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
    return apiRequest(
      '/api/inbox',
      {
        method: 'DELETE',
        auth: true,
      }
    );
  }

  // =========================================================================
  // INBOX RENDERING
  // =========================================================================

  function renderInbox() {
    if (!el.inboxList) {
      return;
    }

    el.inboxList
      .querySelectorAll('.msg-item')
      .forEach((node) => {
        node.remove();
      });

    const messages = [...state.messages];

    if (el.inboxCount) {
      el.inboxCount.textContent =
        String(messages.length);
    }

    if (!messages.length) {
      el.inboxEmpty?.classList.remove(
        'hidden'
      );

      return;
    }

    el.inboxEmpty?.classList.add(
      'hidden'
    );

    messages.forEach((message) => {
      const button =
        document.createElement('button');

      button.type = 'button';

      button.className =
        `msg-item block w-full text-left${
          message.id ===
          state.activeMessageId
            ? ' active'
            : ''
        }`;

      button.dataset.id =
        message.id;

      const sender =
        message.fromName ||
        message.from ||
        'Unknown sender';

      const subject =
        message.subject ||
        '(no subject)';

      const snippet =
        message.intro ||
        '';

      button.innerHTML = `
        <div class="flex items-start gap-3">

          <div class="msg-avatar shrink-0">
            ${escapeHtml(
              getSenderInitial(sender)
            )}
          </div>

          <div class="min-w-0 flex-1">

            <div class="flex items-start justify-between gap-2">

              <span
                class="text-sm font-semibold text-ink-100 truncate"
              >
                ${escapeHtml(sender)}
              </span>

              <span
                class="text-[10px] text-ink-500 font-mono whitespace-nowrap shrink-0"
              >
                ${escapeHtml(
                  formatInboxDate(
                    message.date
                  )
                )}
              </span>

            </div>

            <p
              class="text-sm text-ink-200 mt-1 truncate"
            >
              ${escapeHtml(subject)}
            </p>

            <p
              class="msg-snippet text-xs text-ink-500 mt-1 line-clamp-2"
            >
              ${escapeHtml(snippet)}
            </p>

          </div>

        </div>
      `;

      button.addEventListener(
        'click',
        () => {
          openMessage(message.id);
        }
      );

      el.inboxList.appendChild(
        button
      );
    });
  }

  function getSenderInitial(sender) {
    const clean =
      String(sender || '')
        .trim();

    if (!clean) {
      return '?';
    }

    return clean
      .charAt(0)
      .toUpperCase();
  }

  function formatInboxDate(dateString) {
    if (!dateString) {
      return '';
    }

    const date =
      new Date(dateString);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return '';
    }

    const now = new Date();

    const sameDay =
      date.toDateString() ===
      now.toDateString();

    if (sameDay) {
      return date.toLocaleTimeString(
        undefined,
        {
          hour: '2-digit',
          minute: '2-digit',
        }
      );
    }

    return date.toLocaleDateString(
      undefined,
      {
        month: 'short',
        day: 'numeric',
      }
    );
  }

  // =========================================================================
  // VIEWER
  // =========================================================================

  function resetViewer() {
    state.activeMessageId = null;

    state.activeMessage = null;

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
      el.viewerFrame.srcdoc = '';
    }

    if (el.viewerAttachments) {
      el.viewerAttachments.innerHTML =
        '';

      el.viewerAttachments.classList.add(
        'hidden'
      );
    }
  }

  // =========================================================================
  // SAFE EMAIL DOCUMENT
  // =========================================================================

  function buildSafeMessageDocument(
    html,
    text
  ) {
    let body;

    if (
      html &&
      typeof html === 'string' &&
      html.trim().length
    ) {
      body = html;
    } else {
      body = `
        <div class="plain-email">
          <pre>${escapeHtml(
            text ||
              '(This message has no readable content.)'
          )}</pre>
        </div>
      `;
    }

    return `
      <!doctype html>

      <html>

        <head>

          <meta charset="utf-8">

          <meta
            name="viewport"
            content="width=device-width,initial-scale=1"
          >

          <style>

            * {
              box-sizing: border-box;
            }

            html,
            body {
              margin: 0;
              padding: 0;
              background: #ffffff;
              color: #111827;
              font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                Roboto,
                Helvetica,
                Arial,
                sans-serif;
              font-size: 14px;
              line-height: 1.6;
              word-wrap: break-word;
              overflow-wrap: anywhere;
            }

            body {
              padding: 28px;
            }

            img {
              max-width: 100%;
              height: auto;
            }

            video,
            iframe {
              max-width: 100%;
            }

            table {
              max-width: 100%;
            }

            pre {
              white-space: pre-wrap;
              word-break: break-word;
              font-family:
                ui-monospace,
                SFMono-Regular,
                Menlo,
                Monaco,
                Consolas,
                monospace;
              font-size: 13px;
              line-height: 1.7;
            }

            a {
              color: #087f5b;
            }

            blockquote {
              margin-left: 0;
              padding-left: 16px;
              border-left: 3px solid #d1d5db;
              color: #6b7280;
            }

            .plain-email {
              white-space: normal;
            }

          </style>

        </head>

        <body>

          ${body}

        </body>

      </html>
    `;
  }

  // =========================================================================
  // EMAIL VIEWER HEADER ENHANCEMENTS
  // =========================================================================

  function ensureViewerToolbar() {
    if (!el.viewerContent) {
      return null;
    }

    let toolbar =
      el.viewerContent.querySelector(
        '.vanish-viewer-toolbar'
      );

    if (toolbar) {
      return toolbar;
    }

    toolbar =
      document.createElement('div');

    toolbar.className =
      'vanish-viewer-toolbar';

    toolbar.innerHTML = `
      <div class="flex items-center justify-between gap-3">

        <div class="flex items-center gap-2">

          <button
            type="button"
            class="viewer-tool-btn"
            data-viewer-action="refresh"
            title="Refresh message"
          >
            <i
              data-lucide="refresh-cw"
              style="width:15px;height:15px"
            ></i>
            <span class="hidden sm:inline">
              Refresh
            </span>
          </button>

          <button
            type="button"
            class="viewer-tool-btn"
            data-viewer-action="copy"
            title="Copy sender email"
          >
            <i
              data-lucide="copy"
              style="width:15px;height:15px"
            ></i>
            <span class="hidden sm:inline">
              Copy sender
            </span>
          </button>

        </div>

        <button
          type="button"
          class="viewer-tool-btn viewer-close-btn"
          data-viewer-action="close"
          title="Close message"
        >
          <i
            data-lucide="x"
            style="width:15px;height:15px"
          ></i>
          <span class="hidden sm:inline">
            Close
          </span>
        </button>

      </div>
    `;

    const header =
      el.viewerContent.querySelector(
        ':scope > div'
      );

    if (header) {
      el.viewerContent.insertBefore(
        toolbar,
        header
      );
    } else {
      el.viewerContent.prepend(
        toolbar
      );
    }

    toolbar
      .querySelector(
        '[data-viewer-action="refresh"]'
      )
      ?.addEventListener(
        'click',
        () => {
          if (state.activeMessageId) {
            openMessage(
              state.activeMessageId,
              true
            );
          }
        }
      );

    toolbar
      .querySelector(
        '[data-viewer-action="copy"]'
      )
      ?.addEventListener(
        'click',
        copySender
      );

    toolbar
      .querySelector(
        '[data-viewer-action="close"]'
      )
      ?.addEventListener(
        'click',
        closeViewer
      );

    renderIcons();

    return toolbar;
  }

  // =========================================================================
  // OPEN MESSAGE
  // =========================================================================

  async function openMessage(
    id,
    forceRefresh = false
  ) {
    if (!id) {
      return;
    }

    if (
      state.activeMessageId === id &&
      state.activeMessage &&
      !forceRefresh
    ) {
      return;
    }

    state.activeMessageId = id;

    state.activeMessage = null;

    renderInbox();

    el.viewerEmpty?.classList.add(
      'hidden'
    );

    el.viewerContent?.classList.remove(
      'hidden'
    );

    el.viewerContent?.classList.add(
      'mobile-open'
    );

    ensureViewerToolbar();

    // -------------------------------------------------------
    // Loading state
    // -------------------------------------------------------

    el.viewerSubject.textContent =
      'Loading message…';

    el.viewerFrom.textContent =
      '';

    el.viewerDate.textContent =
      '';

    if (el.viewerAttachments) {
      el.viewerAttachments.innerHTML =
        '';

      el.viewerAttachments.classList.add(
        'hidden'
      );
    }

    if (el.viewerFrame) {
      el.viewerFrame.setAttribute(
        'sandbox',
        ''
      );

      el.viewerFrame.srcdoc = `
        <!doctype html>

        <html>

          <body style="
            margin:0;
            padding:40px;
            background:#ffffff;
            color:#94a3b8;
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
            text-align:center;
          ">

            <div style="
              font-size:13px;
            ">
              Loading message…
            </div>

          </body>

        </html>
      `;
    }

    try {
      const message =
        await fetchMessage(id);

      if (
        state.activeMessageId !== id
      ) {
        return;
      }

      state.activeMessage =
        message;

      // -----------------------------------------------------
      // Subject
      // -----------------------------------------------------

      el.viewerSubject.textContent =
        message.subject ||
        '(no subject)';

      // -----------------------------------------------------
      // Sender
      // -----------------------------------------------------

      const senderName =
        message.fromName ||
        '';

      const senderEmail =
        message.from ||
        'Unknown sender';

      el.viewerFrom.textContent =
        senderName
          ? `${senderName} <${senderEmail}>`
          : senderEmail;

      // -----------------------------------------------------
      // Date
      // -----------------------------------------------------

      el.viewerDate.textContent =
        formatDate(
          message.date
        );

      // -----------------------------------------------------
      // HTML
      // -----------------------------------------------------

      const html =
        Array.isArray(
          message.html
        )
          ? message.html.join('')
          : message.html;

      el.viewerFrame.srcdoc =
        buildSafeMessageDocument(
          html,
          message.text
        );

      // -----------------------------------------------------
      // Attachments
      // -----------------------------------------------------

      renderAttachments(
        message.attachments || []
      );

      renderIcons();

    } catch (error) {
      if (
        state.activeMessageId !== id
      ) {
        return;
      }

      el.viewerSubject.textContent =
        'Could not load this message';

      el.viewerFrom.textContent =
        '';

      el.viewerDate.textContent =
        '';

      el.viewerFrame.srcdoc = `
        <!doctype html>

        <html>

          <body style="
            margin:0;
            padding:32px;
            background:#ffffff;
            color:#b91c1c;
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          ">

            <strong>
              Unable to load this message.
            </strong>

            <p style="
              color:#6b7280;
              font-size:13px;
            ">
              ${escapeHtml(
                error.message ||
                  'Something went wrong.'
              )}
            </p>

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

  // =========================================================================
  // ATTACHMENTS
  // =========================================================================

  function renderAttachments(
    attachments
  ) {
    if (!el.viewerAttachments) {
      return;
    }

    el.viewerAttachments.innerHTML =
      '';

    if (
      !Array.isArray(attachments) ||
      !attachments.length
    ) {
      el.viewerAttachments.classList.add(
        'hidden'
      );

      return;
    }

    el.viewerAttachments.classList.remove(
      'hidden'
    );

    attachments.forEach(
      (attachment) => {
        const item =
          document.createElement('div');

        const downloadable =
          attachment.downloadable === true;

        item.className =
          'attachment-chip';

        item.innerHTML = `
          <div class="flex items-center gap-2 min-w-0">

            <span
              class="attachment-icon"
            >
              <i
                data-lucide="paperclip"
                style="width:13px;height:13px"
              ></i>
            </span>

            <span
              class="truncate"
              title="${escapeHtml(
                attachment.filename ||
                  'attachment'
              )}"
            >
              ${escapeHtml(
                attachment.filename ||
                  'attachment'
              )}
            </span>

          </div>

          <span
            class="text-[10px] text-ink-500 shrink-0"
          >
            ${
              downloadable
                ? 'Available'
                : 'Unavailable'
            }
          </span>
        `;

        el.viewerAttachments.appendChild(
          item
        );
      }
    );

    renderIcons();
  }

  // =========================================================================
  // COPY SENDER
  // =========================================================================

  async function copySender() {
    const sender =
      state.activeMessage?.from ||
      '';

    if (!sender) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        sender
      );

      showToast(
        'Sender address copied.'
      );
    } catch {
      showToast(
        'Could not copy sender address.',
        'error'
      );
    }
  }

  // =========================================================================
  // CLOSE VIEWER
  // =========================================================================

  function closeViewer() {
    state.activeMessageId = null;

    state.activeMessage = null;

    el.viewerContent?.classList.remove(
      'mobile-open'
    );

    el.viewerContent?.classList.add(
      'hidden'
    );

    el.viewerEmpty?.classList.remove(
      'hidden'
    );

    if (el.viewerFrame) {
      el.viewerFrame.srcdoc = '';
    }

    renderInbox();
  }

  // =========================================================================
  // REFRESH MESSAGES
  // =========================================================================

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
      spin(
        el.btnRefresh,
        true
      );
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
            (message) =>
              message.id
          )
        );

      const hasNewMail =
        messages.some(
          (message) =>
            !previousIds.has(
              message.id
            )
        );

      state.messages =
        messages;

      renderInbox();

      if (
        hasNewMail &&
        previousIds.size > 0
      ) {
        showToast(
          'New mail just arrived.'
        );
      }

      // If currently reading a message,
      // refresh its contents when it still exists.
      if (
        state.activeMessageId &&
        messages.some(
          (message) =>
            message.id ===
            state.activeMessageId
        )
      ) {
        /*
         * Don't aggressively reload the iframe
         * during background polling.
         *
         * The message is only reloaded if the
         * currently displayed message was previously
         * unavailable.
         */
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

  // =========================================================================
  // POLLING
  // =========================================================================

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

    state.pollTimer =
      setInterval(
        () => {
          state.msRemaining =
            POLL_MS;

          refreshMessages({
            silent: true,
          });
        },
        POLL_MS
      );

    state.countdownTimer =
      setInterval(
        () => {
          state.msRemaining =
            Math.max(
              0,
              state.msRemaining -
                100
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
        },
        100
      );
  }

  // =========================================================================
  // ACTIVATE INBOX
  // =========================================================================

  async function activateInbox(
    account,
    announce = true
  ) {
    stopPolling();

    state.account =
      account;

    state.messages =
      [];

    state.activeMessageId =
      null;

    state.activeMessage =
      null;

    saveAccount();

    if (el.addressText) {
      el.addressText.textContent =
        account.address;
    }

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

  // =========================================================================
  // COPY ADDRESS
  // =========================================================================

  async function copyAddress() {
    if (!state.account) {
      return;
    }

    const address =
      state.account.address;

    let copied = false;

    try {
      await navigator.clipboard.writeText(
        address
      );

      copied = true;

    } catch {
      const textarea =
        document.createElement(
          'textarea'
        );

      textarea.value =
        address;

      textarea.style.position =
        'fixed';

      textarea.style.opacity =
        '0';

      document.body.appendChild(
        textarea
      );

      textarea.select();

      try {
        copied =
          document.execCommand(
            'copy'
          );
      } catch {
        copied = false;
      }

      textarea.remove();
    }

    if (!copied) {
      showToast(
        'Could not copy the address.',
        'error'
      );

      return;
    }

    if (el.copyTooltip) {
      el.copyTooltip.classList.add(
        'show'
      );

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

  // =========================================================================
  // RANDOM ADDRESS
  // =========================================================================

  async function newRandomAddress() {
    if (state.isBusy) {
      return;
    }

    setBusy(true);

    spin(
      el.btnRandom,
      true
    );

    setAddressLoading(true);

    if (el.addressText) {
      el.addressText.textContent =
        'generating…';
    }

    try {
      const account =
        await createRandomInbox();

      await activateInbox(
        account
      );

    } catch (error) {
      if (el.addressText) {
        el.addressText.textContent =
          state.account?.address ||
          'unavailable';
      }

      setAddressLoading(false);

      showToast(
        error.message ||
          'Could not create an inbox.',
        'error'
      );

    } finally {
      setBusy(false);

      spin(
        el.btnRandom,
        false
      );
    }
  }

  // =========================================================================
  // CUSTOM ADDRESS
  // =========================================================================

  async function createCustomAddress() {
    if (state.isBusy) {
      return;
    }

    const login =
      el.inputPrefix?.value ||
      '';

    const domain =
      el.selectDomain?.value ||
      '';

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

      await activateInbox(
        account
      );

      if (el.inputPrefix) {
        el.inputPrefix.value =
          '';
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

  // =========================================================================
  // DELETE INBOX
  // =========================================================================

  async function deleteCurrentInbox() {
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

    try {
      await deleteInbox();

      stopPolling();

      localStorage.removeItem(
        STORAGE_KEY
      );

      state.account = null;

      state.messages = [];

      state.activeMessageId = null;

      state.activeMessage = null;

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

      spin(
        el.btnDelete,
        false
      );
    }
  }

  // =========================================================================
  // MANUAL REFRESH
  // =========================================================================

  async function manualRefresh() {
    state.msRemaining =
      POLL_MS;

    await refreshMessages({
      silent: false,
    });
  }

  // =========================================================================
  // EVENT LISTENERS
  // =========================================================================

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
        if (
          event.key === 'Enter'
        ) {
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
      closeViewer
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

    // Escape closes the message viewer.
    document.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key === 'Escape' &&
          state.activeMessageId
        ) {
          closeViewer();
        }
      }
    );
  }

  // =========================================================================
  // BOOT
  // =========================================================================

  async function boot() {
    renderIcons();

    bindEvents();

    // Create viewer toolbar once.
    ensureViewerToolbar();

    setAddressLoading(true);

    // -----------------------------------------------------
    // Load domains
    // -----------------------------------------------------

    const domainsReady =
      await loadDomains();

    if (!domainsReady) {
      setAddressLoading(false);

      if (el.addressText) {
        el.addressText.textContent =
          'unavailable';
      }

      return;
    }

    // -----------------------------------------------------
    // Restore existing inbox
    // -----------------------------------------------------

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

    // -----------------------------------------------------
    // Create new inbox
    // -----------------------------------------------------

    try {
      const account =
        await createRandomInbox();

      await activateInbox(
        account,
        false
      );

    } catch (error) {
      setAddressLoading(false);

      if (el.addressText) {
        el.addressText.textContent =
          'unavailable';
      }

      showToast(
        error.message ||
          'Could not create a temporary inbox.',
        'error'
      );
    }
  }

  // =========================================================================
  // START
  // =========================================================================

  document.addEventListener(
    'DOMContentLoaded',
    boot
  );

})();
