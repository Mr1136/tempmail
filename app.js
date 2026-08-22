/* ==========================================================================
   Vanish — TempMailPortal Integration
   Dark email reading experience
   Cloudflare uniqueness protection for custom addresses
   ========================================================================== */

(() => {
  'use strict';

  // ------------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------------

  const API_BASE = 'https://api.tempmailportal.com';

  const VANISH_API =
    'https://vanishtemp-api.kuroogaji.workers.dev';

  const POLL_MS = 9000;

  const STORAGE_KEY =
    'vanish.tempmailportal.v1';

  // ------------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------------

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

    clearTimeout(toastTimer);

    toastTimer =
      setTimeout(() => {
        el.toast.classList.add(
          'hidden'
        );

        el.toast.classList.remove(
          'flex'
        );
      }, 3200);
  }

  // ------------------------------------------------------------------------
  // Security helpers
  // ------------------------------------------------------------------------

  function escapeHtml(value) {
    const div =
      document.createElement('div');

    div.textContent =
      value ?? '';

    return div.innerHTML;
  }

  /*
   * Remove dangerous elements from received email HTML.
   *
   * Email HTML is untrusted content.
   */
  function sanitiseEmailHtml(html) {
    if (!html) {
      return '';
    }

    const parser =
      new DOMParser();

    const document =
      parser.parseFromString(
        html,
        'text/html'
      );

    document
      .querySelectorAll(
        'script, noscript, iframe, object, embed, form, input, button, textarea, select, video, audio'
      )
      .forEach(
        (node) => node.remove()
      );

    document
      .querySelectorAll('*')
      .forEach((node) => {

        [
          ...node.attributes,
        ].forEach((attribute) => {

          if (
            attribute.name
              .toLowerCase()
              .startsWith('on')
          ) {
            node.removeAttribute(
              attribute.name
            );
          }
        });

        if (
          node.hasAttribute('target')
        ) {
          node.setAttribute(
            'target',
            '_blank'
          );
        }
      });

    return document.body
      ? document.body.innerHTML
      : html;
  }

  // ------------------------------------------------------------------------
  // Date formatting
  // ------------------------------------------------------------------------

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
        }
      ) +
      ` · ${time}`
    );
  }

  // ------------------------------------------------------------------------
  // Busy state
  // ------------------------------------------------------------------------

  function setBusy(busy) {
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
    el.addressSkeleton?.classList.toggle(
      'hidden',
      !loading
    );

    el.addressCursor?.classList.toggle(
      'hidden',
      loading
    );
  }

  // ------------------------------------------------------------------------
  // API
  // ------------------------------------------------------------------------

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
      setTimeout(
        () => controller.abort(),
        timeoutMs
      );

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
                ? JSON.stringify(body)
                : undefined,
            signal:
              controller.signal,
          }
        );

    } catch (error) {

      clearTimeout(timeout);

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

    clearTimeout(timeout);

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

    if (!response.ok) {

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

  // ------------------------------------------------------------------------
  // Vanish Cloudflare API
  // ------------------------------------------------------------------------

  async function vanishApiRequest(
    path,
    options = {}
  ) {
    const {
      method = 'GET',
      body,
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

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => controller.abort(),
        timeoutMs
      );

    let response;

    try {

      response =
        await fetch(
          `${VANISH_API}${path}`,
          {
            method,
            headers,
            body:
              body !== undefined
                ? JSON.stringify(body)
                : undefined,
            signal:
              controller.signal,
          }
        );

    } catch (error) {

      clearTimeout(timeout);

      if (
        error.name ===
        'AbortError'
      ) {
        throw new Error(
          'The request timed out.'
        );
      }

      throw new Error(
        'Could not connect to Vanish.'
      );
    }

    clearTimeout(timeout);

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

    if (!response.ok) {

      const error =
        new Error(
          data?.error ||
          `Request failed (${response.status}).`
        );

      error.status =
        response.status;

      throw error;
    }

    return data;
  }

  // ------------------------------------------------------------------------
  // Domains
  // ------------------------------------------------------------------------

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

  // ------------------------------------------------------------------------
  // Inbox creation
  // ------------------------------------------------------------------------

  /*
   * RANDOM INBOX
   *
   * Random addresses continue to be created directly through
   * TempMailPortal.
   */
  async function createRandomInbox() {

    const data =
      await apiRequest(
        '/api/inbox',
        {
          method: 'POST',
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

      isCustom:
        false,

      expiresAt:
        null,
    };
  }

  /*
   * CUSTOM INBOX
   *
   * Custom addresses are created through the Vanish
   * Cloudflare Worker.
   *
   * The Worker handles:
   *
   * 1. D1 uniqueness
   * 2. TempMailPortal creation
   * 3. Reservation expiry
   */
  async function createCustomInbox(
    login,
    domain
  ) {

    const cleanLogin =
      String(login || '')
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

    const data =
      await vanishApiRequest(
        '/reserve',
        {
          method: 'POST',

          body: {
            login:
              cleanLogin,

            domain:
              domain,
          },
        }
      );

    if (
      !data?.address ||
      !data?.token
    ) {
      throw new Error(
        'Vanish could not create that custom address.'
      );
    }

    return {
      address:
        data.address,

      token:
        data.token,

      isCustom:
        true,

      expiresAt:
        Number(
          data.expiresAt
        ) || null,
    };
  }

  // ------------------------------------------------------------------------
  // Storage
  // ------------------------------------------------------------------------

  function saveAccount() {

    if (!state.account) {

      localStorage.removeItem(
        STORAGE_KEY
      );

      return;
    }

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        state.account
      )
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

      /*
       * If this is a custom address and the local
       * reservation has expired, do not restore it.
       */
      if (
        account.isCustom === true &&
        account.expiresAt &&
        Date.now() >=
          Number(account.expiresAt)
      ) {

        localStorage.removeItem(
          STORAGE_KEY
        );

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

  // ------------------------------------------------------------------------
  // Inbox list
  // ------------------------------------------------------------------------

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

    if (
      el.inboxCount
    ) {
      el.inboxCount.textContent =
        String(
          messages.length
        );
    }

    if (
      !messages.length
    ) {

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
          `msg-item${
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
          'No preview available.';

        button.innerHTML = `
          <div class="msg-item-top">

            <div class="msg-sender">
              ${escapeHtml(sender)}
            </div>

            <div class="msg-date">
              ${escapeHtml(
                formatDate(
                  message.date
                )
              )}
            </div>

          </div>

          <div class="msg-subject">
            ${escapeHtml(subject)}
          </div>

          <div class="msg-snippet">
            ${escapeHtml(snippet)}
          </div>
        `;

        button.addEventListener(
          'click',
          () =>
            openMessage(
              message.id
            )
        );

        el.inboxList.appendChild(
          button
        );
      }
    );
  }

  // ------------------------------------------------------------------------
  // DARK EMAIL DOCUMENT
  // ------------------------------------------------------------------------

  function buildDarkEmailDocument(
    html,
    text
  ) {

    let safeHtml =
      sanitiseEmailHtml(
        html
      );

    if (
      !safeHtml.trim()
    ) {

      safeHtml = `
        <div class="plain-text">
          ${escapeHtml(
            text ||
            '(This message has no readable content.)'
          )}
        </div>
      `;
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

        <style>

          :root {
            color-scheme: dark;
          }

          * {
            box-sizing: border-box;
          }

          html {
            margin: 0;
            padding: 0;
            background: #0c1017 !important;
          }

          body {
            margin: 0 !important;
            padding: 28px !important;

            background: #0c1017 !important;

            color: #e7ecf1 !important;

            font-family:
              Inter,
              -apple-system,
              BlinkMacSystemFont,
              "Segoe UI",
              sans-serif !important;

            font-size: 14px !important;

            line-height: 1.65 !important;

            text-align: left !important;

            word-wrap: break-word !important;
            overflow-wrap: anywhere !important;
          }

          table,
          tbody,
          tr,
          td,
          th {
            background-color:
              transparent !important;

            color:
              #e7ecf1 !important;
          }

          div,
          section,
          article,
          main,
          header,
          footer {
            color:
              #e7ecf1 !important;
          }

          p {
            margin-top: 0;
            margin-bottom: 16px;
          }

          h1,
          h2,
          h3,
          h4,
          h5,
          h6 {
            color:
              #f3f6f8 !important;

            line-height: 1.3 !important;

            margin-top: 0;
          }

          h1 {
            font-size: 25px !important;
          }

          h2 {
            font-size: 21px !important;
          }

          h3 {
            font-size: 18px !important;
          }

          a {
            color:
              #37e29a !important;

            text-decoration:
              underline !important;

            text-decoration-color:
              rgba(55,226,154,.45) !important;
          }

          a:hover {
            color:
              #6ff0b7 !important;
          }

          img {
            display: block;

            max-width: 100% !important;

            width: auto;

            height: auto !important;

            border: 0;

            margin-left: 0 !important;
            margin-right: 0 !important;
          }

          table {
            max-width: 100% !important;
          }

          td,
          th {
            max-width: 100% !important;
          }

          pre {
            white-space: pre-wrap !important;
            word-break: break-word !important;

            background:
              #10151d !important;

            border:
              1px solid #1d2430 !important;

            border-radius:
              10px !important;

            padding:
              14px !important;

            color:
              #c2ccd8 !important;

            overflow-x: auto !important;
          }

          code {
            background:
              #151b25 !important;

            color:
              #8a8cf0 !important;

            padding:
              2px 5px !important;

            border-radius:
              5px !important;
          }

          blockquote {
            margin:
              16px 0 !important;

            padding:
              10px 16px !important;

            border-left:
              3px solid #37e29a !important;

            background:
              #10151d !important;

            color:
              #c2ccd8 !important;
          }

          hr {
            border: 0 !important;

            border-top:
              1px solid #1d2430 !important;

            margin:
              22px 0 !important;
          }

          ul,
          ol {
            padding-left:
              22px !important;
          }

          li {
            margin-bottom:
              5px !important;
          }

          .plain-text {
            white-space: pre-wrap;

            font-family:
              "JetBrains Mono",
              ui-monospace,
              SFMono-Regular,
              monospace;

            font-size: 13px;

            line-height: 1.7;

            color: #c2ccd8;

            text-align: left;
          }

          [bgcolor] {
            background-color:
              transparent !important;
          }

          body > table:first-child,
          body > div:first-child {
            margin-left: 0 !important;
            margin-right: auto !important;
          }

          @media (max-width: 640px) {

            body {
              padding:
                18px !important;

              font-size:
                14px !important;
            }

            img {
              max-width:
                100% !important;
            }

            table {
              width:
                100% !important;
            }

          }

        </style>

      </head>

      <body>

        ${safeHtml}

      </body>

      </html>
    `;
  }

  // ------------------------------------------------------------------------
  // Viewer
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

    if (
      el.viewerFrame
    ) {
      el.viewerFrame.srcdoc =
        '';
    }

    if (
      el.viewerAttachments
    ) {

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

    el.viewerSubject.textContent =
      'Loading message…';

    el.viewerFrom.textContent =
      '';

    el.viewerDate.textContent =
      '';

    el.viewerAttachments.innerHTML =
      '';

    el.viewerAttachments.classList.add(
      'hidden'
    );

    el.viewerFrame.setAttribute(
      'sandbox',
      ''
    );

    el.viewerFrame.srcdoc = `
      <!doctype html>

      <html>

        <body style="
          margin:0;
          padding:28px;
          background:#0c1017;
          color:#6b7a8d;
          font-family:Inter,system-ui,sans-serif;
        ">

          Loading message…

        </body>

      </html>
    `;

    try {

      const message =
        await fetchMessage(id);

      if (
        state.activeMessageId !==
        id
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
        formatDate(
          message.date
        );

      const html =
        Array.isArray(
          message.html
        )
          ? message.html.join('')
          : message.html;

      el.viewerFrame.srcdoc =
        buildDarkEmailDocument(
          html,
          message.text
        );

      renderAttachments(
        message.attachments ||
        []
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
            padding:28px;
            background:#0c1017;
            color:#fca5a5;
            font-family:Inter,system-ui,sans-serif;
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

  function renderAttachments(
    attachments
  ) {

    if (
      !el.viewerAttachments
    ) {
      return;
    }

    el.viewerAttachments.innerHTML =
      '';

    if (
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

        const downloadable =
          attachment.downloadable ===
          true;

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

          <span class="attachment-status">
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

  // ------------------------------------------------------------------------
  // Refresh
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

          if (
            el.pollBar
          ) {
            el.pollBar.style.width =
              `${percentage}%`;
          }

          if (
            el.pollLabel
          ) {
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

  // ------------------------------------------------------------------------
  // Activate inbox
  // ------------------------------------------------------------------------

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

    el.addressText.textContent =
      account.address;

    setAddressLoading(
      false
    );

    if (
      el.expiryNote
    ) {

      if (
        account.isCustom ===
          true &&
        account.expiresAt
      ) {

        el.expiryNote.textContent =
          'Address reserved for about 24 hours';

      } else {

        el.expiryNote.textContent =
          'Messages expire after about 24 hours';
      }
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

    if (!state.account) {
      return;
    }

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
        document.execCommand(
          'copy'
        );
      } catch {}

      textarea.remove();
    }

    if (
      el.copyTooltip
    ) {

      el.copyTooltip.classList.add(
        'show'
      );

      setTimeout(
        () => {

          el.copyTooltip.classList.remove(
            'show'
          );

        },
        1500
      );
    }

    if (
      el.addressBox
    ) {

      el.addressBox.classList.add(
        'flash-copied'
      );

      setTimeout(
        () => {

          el.addressBox.classList.remove(
            'flash-copied'
          );

        },
        1500
      );
    }
  }

  // ------------------------------------------------------------------------
  // Random address
  // ------------------------------------------------------------------------

  async function newRandomAddress() {

    if (
      state.isBusy
    ) {
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

    el.addressText.textContent =
      'generating…';

    try {

      const account =
        await createRandomInbox();

      await activateInbox(
        account
      );

    } catch (error) {

      el.addressText.textContent =
        state.account?.address ||
        'unavailable';

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

  // ------------------------------------------------------------------------
  // Custom address
  // ------------------------------------------------------------------------

  async function createCustomAddress() {

    if (
      state.isBusy
    ) {
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

      if (
        el.inputPrefix
      ) {
        el.inputPrefix.value =
          '';
      }

    } catch (error) {

      if (
        error.status ===
        409
      ) {

        showToast(
          'That custom email address is already in use. Please choose another name.',
          'error'
        );

      } else {

        showToast(
          error.message ||
          'Could not create that address.',
          'error'
        );
      }

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

    spin(
      el.btnDelete,
      true
    );

    const accountToDelete =
      state.account;

    try {

      /*
       * First delete the actual TempMailPortal inbox.
       */
      await deleteInbox();

      /*
       * If this is a custom Vanish address,
       * release its D1 reservation too.
       */
      if (
        accountToDelete.isCustom ===
        true
      ) {

        try {

          await vanishApiRequest(
            '/release',
            {
              method: 'POST',

              body: {
                address:
                  accountToDelete.address,

                token:
                  accountToDelete.token,
              },
            }
          );

        } catch (releaseError) {

          console.warn(
            'Could not immediately release custom address:',
            releaseError
          );
        }
      }

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

  // ------------------------------------------------------------------------
  // Manual refresh
  // ------------------------------------------------------------------------

  async function manualRefresh() {

    state.msRemaining =
      POLL_MS;

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

        if (
          event.key ===
          'Enter'
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
      () => {

        state.activeMessageId =
          null;

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

    setAddressLoading(
      true
    );

    const domainsReady =
      await loadDomains();

    if (!domainsReady) {

      setAddressLoading(
        false
      );

      el.addressText.textContent =
        'unavailable';

      return;
    }

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
