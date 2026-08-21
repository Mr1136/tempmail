/* ==========================================================================
   Vanish — TempMailPortal integration
   --------------------------------------------------------------------------
   Receive-only temporary email client.

   API:
   https://api.tempmailportal.com

   Features:
   - Random inbox generation
   - Custom addresses
   - Persistent inbox sessions
   - Automatic polling
   - Polished inbox/message reader
   - Sandboxed email HTML
   - Responsive email rendering
   - Attachment metadata
   - Mobile full-screen reader
   ========================================================================== */

(() => {
  'use strict';

  /* ========================================================================
     CONFIGURATION
     ======================================================================== */

  const API_BASE = 'https://api.tempmailportal.com';

  const POLL_MS = 9000;

  const STORAGE_KEY =
    'vanish.tempmailportal.v1';

  const MAX_EMAIL_HTML_LENGTH = 2_000_000;

  /* ========================================================================
     STATE
     ======================================================================== */

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

    toastTimer: null,

    viewerRequestId: 0,
  };

  /* ========================================================================
     DOM
     ======================================================================== */

  const el = {
    addressText:
      document.getElementById('address-text'),

    addressCursor:
      document.getElementById('address-cursor'),

    addressBox:
      document.getElementById('address-box'),

    addressSkeleton:
      document.getElementById('address-skeleton'),

    expiryNote:
      document.getElementById('expiry-note'),

    btnCopy:
      document.getElementById('btn-copy'),

    copyTooltip:
      document.getElementById('copy-tooltip'),

    btnRefresh:
      document.getElementById('btn-refresh'),

    btnRandom:
      document.getElementById('btn-random'),

    btnDelete:
      document.getElementById('btn-delete'),

    inputPrefix:
      document.getElementById('input-prefix'),

    selectDomain:
      document.getElementById('select-domain'),

    btnCreateCustom:
      document.getElementById('btn-create-custom'),

    pollBar:
      document.getElementById('poll-bar'),

    pollLabel:
      document.getElementById('poll-label'),

    inboxList:
      document.getElementById('inbox-list'),

    inboxEmpty:
      document.getElementById('inbox-empty'),

    inboxCount:
      document.getElementById('inbox-count'),

    viewerEmpty:
      document.getElementById('viewer-empty'),

    viewerContent:
      document.getElementById('viewer-content'),

    viewerSubject:
      document.getElementById('viewer-subject'),

    viewerFrom:
      document.getElementById('viewer-from'),

    viewerDate:
      document.getElementById('viewer-date'),

    viewerAttachments:
      document.getElementById('viewer-attachments'),

    viewerFrame:
      document.getElementById('viewer-frame'),

    btnCloseViewer:
      document.getElementById('btn-close-viewer'),

    toast:
      document.getElementById('toast'),

    toastText:
      document.getElementById('toast-text'),
  };

  /* ========================================================================
     ICONS
     ======================================================================== */

  function renderIcons() {
    if (
      window.lucide &&
      typeof window.lucide.createIcons === 'function'
    ) {
      window.lucide.createIcons();
    }
  }

  /* ========================================================================
     TOASTS
     ======================================================================== */

  function showToast(
    message,
    type = 'info'
  ) {
    if (!el.toast || !el.toastText) {
      return;
    }

    el.toastText.textContent =
      message;

    el.toast.classList.remove(
      'hidden'
    );

    el.toast.classList.add(
      'flex'
    );

    const icon =
      el.toast.querySelector('i');

    if (icon) {
      icon.setAttribute(
        'data-lucide',
        type === 'error'
          ? 'alert-triangle'
          : 'info'
      );

      renderIcons();
    }

    clearTimeout(
      state.toastTimer
    );

    state.toastTimer =
      setTimeout(() => {
        el.toast.classList.add(
          'hidden'
        );

        el.toast.classList.remove(
          'flex'
        );
      }, 3200);
  }

  /* ========================================================================
     GENERAL UTILITIES
     ======================================================================== */

  function escapeHtml(value) {
    const div =
      document.createElement('div');

    div.textContent =
      value ?? '';

    return div.innerHTML;
  }

  function formatDate(dateString) {
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

    const now =
      new Date();

    const sameDay =
      date.toDateString() ===
      now.toDateString();

    const time =
      date.toLocaleTimeString(
        undefined,
        {
          hour: '2-digit',
          minute: '2-digit',
        }
      );

    if (sameDay) {
      return `Today, ${time}`;
    }

    return (
      date.toLocaleDateString(
        undefined,
        {
          month: 'short',
          day: 'numeric',
          year:
            date.getFullYear() !==
            now.getFullYear()
              ? 'numeric'
              : undefined,
        }
      ) +
      ` · ${time}`
    );
  }

  function truncate(
    value,
    maxLength
  ) {
    const text =
      String(value || '');

    if (
      text.length <= maxLength
    ) {
      return text;
    }

    return (
      text.slice(
        0,
        maxLength - 1
      ) + '…'
    );
  }

  /* ========================================================================
     BUTTON STATE
     ======================================================================== */

  function setBusy(
    busy
  ) {
    state.isBusy =
      busy;

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

      button.disabled =
        busy;

      button.classList.toggle(
        'opacity-50',
        busy
      );

      button.classList.toggle(
        'cursor-not-allowed',
        busy
      );
    });
  }

  function spin(
    button,
    spinning
  ) {
    if (!button) {
      return;
    }

    const icon =
      button.querySelector('i');

    if (!icon) {
      return;
    }

    icon.classList.toggle(
      'animate-spin',
      spinning
    );
  }

  function setAddressLoading(
    loading
  ) {
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

  /* ========================================================================
     API
     ======================================================================== */

  async function apiRequest(
    path,
    options = {}
  ) {
    const {
      method = 'GET',
      body,
      auth = false,
      timeoutMs = 15000,
    } = options;

    const headers = {
      Accept:
        'application/json',
    };

    if (
      body !== undefined
    ) {
      headers[
        'Content-Type'
      ] =
        'application/json';
    }

    if (auth) {
      if (
        !state.account?.token
      ) {
        throw new Error(
          'Your inbox session is missing.'
        );
      }

      headers.Authorization =
        `Bearer ${state.account.token}`;
    }

    const controller =
      new AbortController();

    const timeout =
      setTimeout(() => {
        controller.abort();
      }, timeoutMs);

    let response;

    try {
      response =
        await fetch(
          `${API_BASE}${path}`,
          {
            method,
            headers,

            body:
              body !== undefined
                ? JSON.stringify(
                    body
                  )
                : undefined,

            signal:
              controller.signal,
          }
        );
    } catch (error) {
      clearTimeout(
        timeout
      );

      if (
        error.name ===
        'AbortError'
      ) {
        throw new Error(
          'The request timed out.'
        );
      }

      throw new Error(
        'Could not connect to the temporary-mail service.'
      );
    }

    clearTimeout(
      timeout
    );

    const text =
      await response.text();

    let data = null;

    if (text) {
      try {
        data =
          JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (
      !response.ok
    ) {
      if (
        response.status ===
        401
      ) {
        throw new Error(
          'This inbox session has expired.'
        );
      }

      if (
        response.status ===
        404
      ) {
        throw new Error(
          'This inbox no longer exists.'
        );
      }

      if (
        response.status ===
        429
      ) {
        const retry =
          response.headers.get(
            'Retry-After'
          );

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

  /* ========================================================================
     DOMAINS
     ======================================================================== */

  async function fetchDomains() {
    const data =
      await apiRequest(
        '/api/domains'
      );

    if (
      !Array.isArray(data)
    ) {
      throw new Error(
        'The temporary-mail service returned an invalid domain list.'
      );
    }

    return data.filter(
      (domain) =>
        typeof domain ===
          'string' &&
        domain.length > 0
    );
  }

  async function loadDomains() {
    try {
      state.domains =
        await fetchDomains();

      if (
        !state.domains.length
      ) {
        throw new Error(
          'No temporary-mail domains are currently available.'
        );
      }

      if (
        el.selectDomain
      ) {
        el.selectDomain.innerHTML =
          '';

        state.domains.forEach(
          (domain) => {
            const option =
              document.createElement(
                'option'
              );

            option.value =
              domain;

            option.textContent =
              `@${domain}`;

            el.selectDomain.appendChild(
              option
            );
          }
        );
      }

      return true;
    } catch (error) {
      if (
        el.selectDomain
      ) {
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

  /* ========================================================================
     INBOX CREATION
     ======================================================================== */

  async function createInbox(
    options = {}
  ) {
    const data =
      await apiRequest(
        '/api/inbox',
        {
          method: 'POST',

          body:
            Object.keys(options)
              .length
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
      address:
        data.address,

      token:
        data.token,
    };
  }

  async function createRandomInbox() {
    return createInbox();
  }

  async function createCustomInbox(
    login,
    domain
  ) {
    const cleanLogin =
      String(
        login || ''
      )
        .trim()
        .toLowerCase()
        .replace(
          /[^a-z0-9._-]/g,
          ''
        )
        .slice(
          0,
          30
        );

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
      login:
        cleanLogin,

      domain,
    });
  }

  /* ========================================================================
     PERSISTENCE
     ======================================================================== */

  function saveAccount() {
    if (!state.account) {
      localStorage.removeItem(
        STORAGE_KEY
      );

      return;
    }

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          state.account
        )
      );
    } catch {
      // Ignore localStorage failures.
    }
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
        JSON.parse(
          saved
        );

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

  /* ========================================================================
     MESSAGE API
     ======================================================================== */

  async function fetchMessages() {
    return apiRequest(
      '/api/messages',
      {
        auth: true,
      }
    );
  }

  async function fetchMessage(
    id
  ) {
    return apiRequest(
      `/api/messages/${encodeURIComponent(
        id
      )}`,
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

  /* ========================================================================
     INBOX RENDERING
     ======================================================================== */

  function renderInbox() {
    if (!el.inboxList) {
      return;
    }

    el.inboxList
      .querySelectorAll(
        '.msg-item'
      )
      .forEach(
        (node) =>
          node.remove()
      );

    const messages =
      [...state.messages];

    if (el.inboxCount) {
      el.inboxCount.textContent =
        String(
          messages.length
        );
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

    messages.forEach(
      (message) => {
        const button =
          document.createElement(
            'button'
          );

        button.type =
          'button';

        button.className =
          `msg-item block${
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

        button.setAttribute(
          'aria-label',
          `Open email from ${sender}: ${subject}`
        );

        button.innerHTML = `
          <div class="flex items-start gap-3">

            <div
              class="msg-avatar shrink-0 h-9 w-9 rounded-xl bg-ink-800 border border-ink-700 flex items-center justify-center"
            >
              <span class="text-xs font-semibold text-signal">
                ${escapeHtml(
                  sender
                    .trim()
                    .charAt(0)
                    .toUpperCase() ||
                    '?'
                )}
              </span>
            </div>

            <div class="min-w-0 flex-1">

              <div class="flex items-start justify-between gap-2">

                <span
                  class="text-sm font-medium text-ink-100 truncate"
                >
                  ${escapeHtml(
                    truncate(
                      sender,
                      50
                    )
                  )}
                </span>

                <span
                  class="text-[10px] text-ink-500 font-mono whitespace-nowrap shrink-0"
                >
                  ${escapeHtml(
                    formatDate(
                      message.date
                    )
                  )}
                </span>

              </div>

              <p
                class="text-sm text-ink-300 mt-1 truncate"
              >
                ${escapeHtml(
                  truncate(
                    subject,
                    90
                  )
                )}
              </p>

              <p
                class="msg-snippet text-xs text-ink-500 mt-1"
              >
                ${escapeHtml(
                  truncate(
                    snippet,
                    120
                  )
                )}
              </p>

            </div>

          </div>
        `;

        button.addEventListener(
          'click',
          () => {
            openMessage(
              message.id
            );
          }
        );

        el.inboxList.appendChild(
          button
        );
      }
    );
  }

  /* ========================================================================
     VIEWER
     ======================================================================== */

  function resetViewer() {
    state.activeMessageId =
      null;

    state.viewerRequestId++;

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

  /* ========================================================================
     SAFE EMAIL DOCUMENT
     ======================================================================== */

  function buildSafeMessageDocument(
    html,
    text
  ) {
    let emailContent =
      html &&
      String(html).trim().length
        ? String(html)
        : `
          <div class="vanish-plain-text">
            ${escapeHtml(
              text ||
                '(This message has no readable content.)'
            )}
          </div>
        `;

    /*
     * Prevent an excessively large message from locking
     * up the browser.
     */

    if (
      emailContent.length >
      MAX_EMAIL_HTML_LENGTH
    ) {
      emailContent =
        emailContent.slice(
          0,
          MAX_EMAIL_HTML_LENGTH
        ) +
        `
          <div style="
            margin-top:24px;
            padding:12px;
            border:1px solid #f0c36d;
            background:#fff8e5;
            color:#705300;
            border-radius:8px;
            font-family:sans-serif;
            font-size:13px;
          ">
            This email was truncated because it is unusually large.
          </div>
        `;
    }

    /*
     * Some email clients return HTML wrapped in complete
     * html/body tags. Extracting only the body prevents
     * nested documents from causing layout problems.
     */

    try {
      const parser =
        new DOMParser();

      const parsed =
        parser.parseFromString(
          emailContent,
          'text/html'
        );

      if (
        parsed.body &&
        parsed.body.innerHTML.trim()
      ) {
        emailContent =
          parsed.body.innerHTML;
      }
    } catch {
      // Keep original HTML if parsing fails.
    }

    return `
      <!doctype html>

      <html lang="en">

        <head>

          <meta charset="utf-8">

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          >

          <meta
            name="color-scheme"
            content="light"
          >

          <title>Email</title>

          <style>

            *,
            *::before,
            *::after {
              box-sizing: border-box;
            }

            html {
              margin: 0;
              padding: 0;
              background: #f4f6f8;
            }

            body {
              margin: 0;
              padding: 0;

              background: #f4f6f8;
              color: #18212b;

              font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                Roboto,
                Helvetica,
                Arial,
                sans-serif;

              font-size: 15px;
              line-height: 1.65;

              word-wrap: break-word;
              overflow-wrap: anywhere;

              -webkit-font-smoothing: antialiased;
              text-rendering: optimizeLegibility;
            }

            .vanish-email-shell {
              width: 100%;
              max-width: 900px;

              margin: 0 auto;

              padding: 24px;
            }

            .vanish-email-card {
              width: 100%;

              background: #ffffff;

              border:
                1px solid #e1e6eb;

              border-radius: 14px;

              box-shadow:
                0 1px 2px rgba(15,23,42,.04),
                0 10px 30px rgba(15,23,42,.06);

              overflow: hidden;
            }

            .vanish-email-bar {
              height: 4px;

              background:
                linear-gradient(
                  90deg,
                  #37E29A,
                  #8A8CF0
                );
            }

            .vanish-email-inner {
              padding: 30px;
            }

            h1,
            h2,
            h3,
            h4,
            h5,
            h6 {
              color: #111827;

              line-height: 1.3;

              margin-top: 1.4em;
              margin-bottom: .55em;

              font-weight: 700;
            }

            h1 {
              font-size: 28px;
            }

            h2 {
              font-size: 23px;
            }

            h3 {
              font-size: 19px;
            }

            h4,
            h5,
            h6 {
              font-size: 16px;
            }

            p {
              margin:
                0 0 1em;
            }

            p:last-child {
              margin-bottom: 0;
            }

            strong,
            b {
              color: #111827;
              font-weight: 650;
            }

            a {
              color: #087a55;

              text-decoration:
                underline;

              text-decoration-color:
                rgba(8,122,85,.35);

              text-underline-offset:
                2px;
            }

            img {
              display: block;

              max-width: 100% !important;
              height: auto !important;

              border: 0;
            }

            table {
              max-width: 100% !important;

              border-collapse:
                collapse;

              border-spacing: 0;
            }

            td,
            th {
              max-width: 100%;

              overflow-wrap:
                anywhere;
            }

            blockquote {
              margin:
                18px 0;

              padding:
                12px 16px;

              border-left:
                3px solid #37E29A;

              background:
                #f5f8f7;

              color:
                #53606d;

              border-radius:
                0 8px 8px 0;
            }

            code {
              padding:
                2px 5px;

              border-radius:
                5px;

              background:
                #eef1f4;

              color:
                #293442;

              font-family:
                ui-monospace,
                SFMono-Regular,
                Menlo,
                Monaco,
                Consolas,
                monospace;

              font-size:
                .9em;
            }

            pre {
              max-width: 100%;

              padding: 14px;

              overflow-x: auto;

              border-radius: 9px;

              background:
                #111827;

              color:
                #e5e7eb;

              font-family:
                ui-monospace,
                SFMono-Regular,
                Menlo,
                Monaco,
                Consolas,
                monospace;

              font-size: 12px;

              line-height: 1.55;

              white-space:
                pre-wrap;

              overflow-wrap:
                anywhere;
            }

            pre code {
              padding: 0;

              background:
                transparent;

              color:
                inherit;
            }

            ul,
            ol {
              margin:
                .6em 0 1em;

              padding-left:
                1.6em;
            }

            li {
              margin-bottom:
                .35em;
            }

            hr {
              height: 1px;

              margin:
                24px 0;

              border: 0;

              background:
                #e5e9ed;
            }

            video,
            object,
            embed,
            iframe {
              max-width:
                100%;
            }

            input,
            textarea,
            select,
            button {
              max-width:
                100%;
            }

            .vanish-plain-text {
              white-space:
                pre-wrap;

              font-family:
                ui-monospace,
                SFMono-Regular,
                Menlo,
                Monaco,
                Consolas,
                monospace;

              font-size:
                13px;

              line-height:
                1.7;

              color:
                #293442;
            }

            @media (max-width: 700px) {

              body {
                font-size:
                  14px;
              }

              .vanish-email-shell {
                padding:
                  10px;
              }

              .vanish-email-inner {
                padding:
                  20px;
              }

              .vanish-email-card {
                border-radius:
                  10px;
              }

              h1 {
                font-size:
                  24px;
              }

              h2 {
                font-size:
                  20px;
              }

              h3 {
                font-size:
                  17px;
              }

              table {
                max-width:
                  100% !important;
              }

              img {
                max-width:
                  100% !important;

                height:
                  auto !important;
              }

              pre {
                font-size:
                  11px;
              }
            }

            @media (max-width: 420px) {

              .vanish-email-shell {
                padding:
                  6px;
              }

              .vanish-email-inner {
                padding:
                  16px;
              }

            }

          </style>

        </head>

        <body>

          <div class="vanish-email-shell">

            <div class="vanish-email-card">

              <div class="vanish-email-bar"></div>

              <div class="vanish-email-inner">

                ${emailContent}

              </div>

            </div>

          </div>

        </body>

      </html>
    `;
  }

  /* ========================================================================
     OPEN MESSAGE
     ======================================================================== */

  async function openMessage(
    id
  ) {
    if (!id) {
      return;
    }

    const requestId =
      ++state.viewerRequestId;

    state.activeMessageId =
      id;

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

    if (el.viewerSubject) {
      el.viewerSubject.textContent =
        'Loading message…';
    }

    if (el.viewerFrom) {
      el.viewerFrom.textContent =
        '';
    }

    if (el.viewerDate) {
      el.viewerDate.textContent =
        '';
    }

    if (el.viewerAttachments) {
      el.viewerAttachments.innerHTML =
        '';

      el.viewerAttachments.classList.add(
        'hidden'
      );
    }

    /*
     * Keep the iframe completely sandboxed.
     */

    el.viewerFrame?.setAttribute(
      'sandbox',
      ''
    );

    if (el.viewerFrame) {
      el.viewerFrame.srcdoc = `
        <!doctype html>
        <html>
          <body style="
            margin:0;
            padding:28px;
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
            color:#6B7A8D;
            background:#f4f6f8;
          ">
            <div style="
              max-width:500px;
              margin:30px auto;
              text-align:center;
            ">
              Loading message…
            </div>
          </body>
        </html>
      `;
    }

    try {
      const message =
        await fetchMessage(
          id
        );

      /*
       * User opened another email while this one
       * was loading.
       */

      if (
        requestId !==
        state.viewerRequestId ||
        state.activeMessageId !==
        id
      ) {
        return;
      }

      if (el.viewerSubject) {
        el.viewerSubject.textContent =
          message.subject ||
          '(no subject)';
      }

      if (el.viewerFrom) {
        el.viewerFrom.textContent =
          message.fromName
            ? `${message.fromName} <${message.from}>`
            : message.from ||
              'Unknown sender';
      }

      if (el.viewerDate) {
        el.viewerDate.textContent =
          formatDate(
            message.date
          );
      }

      let html =
        Array.isArray(
          message.html
        )
          ? message.html.join('')
          : message.html;

      let text =
        message.text ||
        '';

      /*
       * Some APIs return an empty HTML array.
       */

      if (
        !html ||
        !String(html).trim()
      ) {
        html = '';
      }

      if (
        !text ||
        !String(text).trim()
      ) {
        text =
          message.intro ||
          '';
      }

      if (el.viewerFrame) {
        el.viewerFrame.srcdoc =
          buildSafeMessageDocument(
            html,
            text
          );
      }

      renderAttachments(
        message.attachments ||
          []
      );

      renderIcons();

    } catch (error) {

      if (
        requestId !==
        state.viewerRequestId
      ) {
        return;
      }

      if (el.viewerSubject) {
        el.viewerSubject.textContent =
          'Could not load this message';
      }

      if (el.viewerFrame) {
        el.viewerFrame.srcdoc = `
          <!doctype html>

          <html>

            <body style="
              margin:0;
              padding:30px;
              background:#f4f6f8;
              font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
              color:#374151;
            ">

              <div style="
                max-width:600px;
                margin:30px auto;
                padding:24px;
                background:#fff;
                border:1px solid #e1e6eb;
                border-radius:12px;
              ">

                <strong>
                  Unable to load this message
                </strong>

                <p style="
                  color:#6b7280;
                  font-size:13px;
                  margin-top:8px;
                ">
                  ${escapeHtml(
                    error.message ||
                      'Something went wrong.'
                  )}
                </p>

              </div>

            </body>

          </html>
        `;
      }

      showToast(
        error.message ||
          'Could not load this message.',
        'error'
      );
    }
  }

  /* ========================================================================
     ATTACHMENTS
     ======================================================================== */

  function renderAttachments(
    attachments
  ) {
    if (!el.viewerAttachments) {
      return;
    }

    el.viewerAttachments.innerHTML =
      '';

    if (
      !Array.isArray(
        attachments
      ) ||
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
          document.createElement(
            'div'
          );

        item.className =
          'attachment-chip';

        const downloadable =
          attachment.downloadable ===
          true;

        const filename =
          attachment.filename ||
          'attachment';

        item.innerHTML = `
          <i
            data-lucide="paperclip"
            style="width:13px;height:13px"
          ></i>

          <span>
            ${escapeHtml(
              truncate(
                filename,
                45
              )
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

        el.viewerAttachments.appendChild(
          item
        );
      }
    );

    renderIcons();
  }

  /* ========================================================================
     REFRESH INBOX
     ======================================================================== */

  async function refreshMessages({
    silent = false,
  } = {}) {
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
      const messages =
        await fetchMessages();

      if (
        !Array.isArray(
          messages
        )
      ) {
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

    } catch (error) {

      /*
       * If the account is no longer valid, remove it
       * and create a new one on the next boot/refresh.
       */

      if (
        /expired|no longer exists/i.test(
          error.message || ''
        )
      ) {
        stopPolling();

        localStorage.removeItem(
          STORAGE_KEY
        );

        state.account =
          null;

        showToast(
          'This inbox has expired. Create a new address.',
          'error'
        );
      } else if (!silent) {
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

  /* ========================================================================
     POLLING
     ======================================================================== */

  function stopPolling() {
    clearInterval(
      state.pollTimer
    );

    clearInterval(
      state.countdownTimer
    );

    state.pollTimer =
      null;

    state.countdownTimer =
      null;
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

  /* ========================================================================
     ACCOUNT ACTIVATION
     ======================================================================== */

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

    saveAccount();

    if (el.addressText) {
      el.addressText.textContent =
        account.address;
    }

    setAddressLoading(
      false
    );

    if (el.expiryNote) {
      el.expiryNote.textContent =
        'Messages expire after about 24 hours';
    }

    resetViewer();

    renderInbox();

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

  /* ========================================================================
     COPY ADDRESS
     ======================================================================== */

  async function copyAddress() {
    if (!state.account) {
      return;
    }

    const address =
      state.account.address;

    let copied =
      false;

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

      textarea.style.left =
        '-9999px';

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
        copied =
          false;
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

  /* ========================================================================
     RANDOM ADDRESS
     ======================================================================== */

  async function newRandomAddress() {
    if (state.isBusy) {
      return;
    }

    setBusy(true);

    spin(
      el.btnRandom,
      true
    );

    setAddressLoading(
      true
    );

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

      setAddressLoading(
        false
      );

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

  /* ========================================================================
     CUSTOM ADDRESS
     ======================================================================== */

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

  /* ========================================================================
     DELETE INBOX
     ======================================================================== */

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

      state.account =
        null;

      state.messages =
        [];

      state.activeMessageId =
        null;

      renderInbox();

      resetViewer();

      if (el.addressText) {
        el.addressText.textContent =
          'generating…';
      }

      setAddressLoading(
        true
      );

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

      if (
        state.account
      ) {
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

  /* ========================================================================
     MANUAL REFRESH
     ======================================================================== */

  async function manualRefresh() {
    state.msRemaining =
      POLL_MS;

    await refreshMessages({
      silent: false,
    });
  }

  /* ========================================================================
     MOBILE VIEWER
     ======================================================================== */

  function closeViewer() {
    state.activeMessageId =
      null;

    state.viewerRequestId++;

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
      el.viewerFrame.srcdoc =
        '';
    }

    renderInbox();
  }

  /* ========================================================================
     EVENT LISTENERS
     ======================================================================== */

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
          event.key ===
          'Enter'
        ) {
          event.preventDefault();

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
          state.msRemaining =
            POLL_MS;

          refreshMessages({
            silent: true,
          });
        }
      }
    );

    /*
     * Escape closes the opened message on desktop/mobile.
     */

    document.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key ===
          'Escape' &&
          state.activeMessageId
        ) {
          closeViewer();
        }
      }
    );

    /*
     * Keep polling sensible when the browser tab is hidden.
     */

    window.addEventListener(
      'beforeunload',
      () => {
        stopPolling();
      }
    );
  }

  /* ========================================================================
     BOOT
     ======================================================================== */

  async function boot() {
    renderIcons();

    bindEvents();

    setAddressLoading(
      true
    );

    /*
     * 1. Load domains.
     */

    const domainsReady =
      await loadDomains();

    if (!domainsReady) {
      setAddressLoading(
        false
      );

      if (el.addressText) {
        el.addressText.textContent =
          'unavailable';
      }

      return;
    }

    /*
     * 2. Restore existing inbox.
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

        state.account =
          null;
      }
    }

    /*
     * 3. Create a new inbox.
     */

    try {
      const account =
        await createRandomInbox();

      await activateInbox(
        account,
        false
      );

    } catch (error) {

      setAddressLoading(
        false
      );

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

  /* ========================================================================
     START
     ======================================================================== */

  document.addEventListener(
    'DOMContentLoaded',
    boot
  );

})();
