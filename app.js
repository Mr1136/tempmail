/* ==========================================================================
   VANISH — TEMPMAILPORTAL INTEGRATION
   ==========================================================================
   Features:
   - Temporary inbox creation
   - Random/custom addresses
   - Persistent inbox session
   - Automatic polling
   - Message viewer
   - Sandboxed email HTML
   - Dark Vanish email styling
   - Attachment metadata
   - Mobile viewer
   ========================================================================== */

(() => {
  'use strict';


  /* =========================================================================
     CONFIGURATION
     ========================================================================= */

  const API_BASE =
    'https://api.tempmailportal.com';

  const POLL_MS =
    9000;

  const STORAGE_KEY =
    'vanish.tempmailportal.v1';


  /* =========================================================================
     STATE
     ========================================================================= */

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


  /* =========================================================================
     DOM
     ========================================================================= */

  const el = {

    addressText:
      document.getElementById(
        'address-text'
      ),

    addressCursor:
      document.getElementById(
        'address-cursor'
      ),

    addressBox:
      document.getElementById(
        'address-box'
      ),

    addressSkeleton:
      document.getElementById(
        'address-skeleton'
      ),

    expiryNote:
      document.getElementById(
        'expiry-note'
      ),

    btnCopy:
      document.getElementById(
        'btn-copy'
      ),

    copyTooltip:
      document.getElementById(
        'copy-tooltip'
      ),

    btnRefresh:
      document.getElementById(
        'btn-refresh'
      ),

    btnRandom:
      document.getElementById(
        'btn-random'
      ),

    btnDelete:
      document.getElementById(
        'btn-delete'
      ),

    inputPrefix:
      document.getElementById(
        'input-prefix'
      ),

    selectDomain:
      document.getElementById(
        'select-domain'
      ),

    btnCreateCustom:
      document.getElementById(
        'btn-create-custom'
      ),

    pollBar:
      document.getElementById(
        'poll-bar'
      ),

    pollLabel:
      document.getElementById(
        'poll-label'
      ),

    inboxList:
      document.getElementById(
        'inbox-list'
      ),

    inboxEmpty:
      document.getElementById(
        'inbox-empty'
      ),

    inboxCount:
      document.getElementById(
        'inbox-count'
      ),

    viewerEmpty:
      document.getElementById(
        'viewer-empty'
      ),

    viewerContent:
      document.getElementById(
        'viewer-content'
      ),

    viewerSubject:
      document.getElementById(
        'viewer-subject'
      ),

    viewerFrom:
      document.getElementById(
        'viewer-from'
      ),

    viewerDate:
      document.getElementById(
        'viewer-date'
      ),

    viewerAttachments:
      document.getElementById(
        'viewer-attachments'
      ),

    viewerFrame:
      document.getElementById(
        'viewer-frame'
      ),

    btnCloseViewer:
      document.getElementById(
        'btn-close-viewer'
      ),

    toast:
      document.getElementById(
        'toast'
      ),

    toastText:
      document.getElementById(
        'toast-text'
      ),

  };


  let toastTimer = null;


  /* =========================================================================
     ICONS
     ========================================================================= */

  function renderIcons() {

    if (
      window.lucide &&
      typeof window.lucide.createIcons ===
        'function'
    ) {

      window.lucide.createIcons();

    }

  }


  /* =========================================================================
     TOAST
     ========================================================================= */

  function showToast(
    message,
    type = 'info'
  ) {

    if (
      !el.toast ||
      !el.toastText
    ) {
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
      el.toast.querySelector(
        'i'
      );

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
      toastTimer
    );

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


  /* =========================================================================
     SECURITY / HTML ESCAPING
     ========================================================================= */

  function escapeHtml(
    value
  ) {

    const div =
      document.createElement(
        'div'
      );

    div.textContent =
      value ?? '';

    return div.innerHTML;

  }


  /* =========================================================================
     DATE FORMATTING
     ========================================================================= */

  function formatDate(
    dateString
  ) {

    if (!dateString) {
      return '';
    }

    const date =
      new Date(
        dateString
      );

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


  /* =========================================================================
     BUSY STATE
     ========================================================================= */

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

    ].forEach(
      (button) => {

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

      }
    );

  }


  /* =========================================================================
     BUTTON SPINNER
     ========================================================================= */

  function spin(
    button,
    spinning
  ) {

    if (!button) {
      return;
    }

    const icon =
      button.querySelector(
        'i'
      );

    if (!icon) {
      return;
    }

    icon.classList.toggle(
      'animate-spin',
      spinning
    );

  }


  /* =========================================================================
     ADDRESS LOADING
     ========================================================================= */

  function setAddressLoading(
    loading
  ) {

    if (
      el.addressSkeleton
    ) {

      el.addressSkeleton.classList.toggle(
        'hidden',
        !loading
      );

    }

    if (
      el.addressCursor
    ) {

      el.addressCursor.classList.toggle(
        'hidden',
        loading
      );

    }

  }


  /* =========================================================================
     API
     ========================================================================= */

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
        () => {
          controller.abort();
        },
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
          JSON.parse(
            text
          );

      } catch {

        data = null;

      }

    }


    if (
      !response.ok
    ) {

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


  /* =========================================================================
     DOMAINS
     ========================================================================= */

  async function fetchDomains() {

    const data =
      await apiRequest(
        '/api/domains'
      );


    if (
      !Array.isArray(
        data
      )
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


  /* =========================================================================
     CREATE INBOX
     ========================================================================= */

  async function createInbox(
    options = {}
  ) {

    const data =
      await apiRequest(
        '/api/inbox',
        {

          method: 'POST',

          body:
            Object.keys(
              options
            ).length
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


  /* =========================================================================
     STORAGE
     ========================================================================= */

  function saveAccount() {

    if (
      !state.account
    ) {

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


  /* =========================================================================
     MESSAGE API
     ========================================================================= */

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


  /* =========================================================================
     INBOX RENDERING
     ========================================================================= */

  function renderInbox() {

    if (
      !el.inboxList
    ) {
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
          'msg-item';


        if (
          message.id ===
          state.activeMessageId
        ) {

          button.classList.add(
            'active'
          );

        }


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
          'No preview available';


        button.innerHTML = `

          <div class="flex items-start justify-between gap-3">

            <span
              class="msg-sender text-sm truncate"
            >
              ${escapeHtml(
                sender
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
            class="msg-subject text-sm mt-1 truncate"
          >
            ${escapeHtml(
              subject
            )}
          </p>


          <p
            class="msg-snippet text-xs mt-1"
          >
            ${escapeHtml(
              snippet
            )}
          </p>

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


  /* =========================================================================
     VIEWER RESET
     ========================================================================= */

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


  /* =========================================================================
     EMAIL DOCUMENT
     ========================================================================= */

  function buildSafeMessageDocument(
    html,
    text
  ) {

    /*
     * The message is deliberately placed inside a
     * completely sandboxed iframe.
     *
     * No JavaScript.
     * No forms.
     * No top navigation.
     *
     * This keeps untrusted email HTML away from
     * the Vanish application.
     */

    const body =
      html && html.length
        ? html
        : `
          <div class="plain-message">
            ${escapeHtml(
              text ||
                '(This message has no readable content.)'
            )}
          </div>
        `;


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


          html {
            margin: 0;
            padding: 0;

            background:
              #10151D !important;
          }


          body {

            margin: 0 !important;

            padding: 28px !important;

            min-height: 100vh;

            background:
              linear-gradient(
                180deg,
                #151B25 0%,
                #10151D 100%
              ) !important;

            color:
              #C2CCD8 !important;

            font-family:
              Inter,
              -apple-system,
              BlinkMacSystemFont,
              "Segoe UI",
              sans-serif !important;

            font-size:
              14px !important;

            line-height:
              1.65 !important;

            word-wrap:
              break-word !important;

            overflow-wrap:
              anywhere !important;

          }


          /*
           * Basic containers
           */

          table,
          td,
          th,
          div,
          section,
          article,
          main {

            max-width:
              100% !important;

          }


          /*
           * Typography
           */

          p,
          span,
          div,
          td,
          th,
          li,
          label {

            max-width:
              100% !important;

          }


          h1,
          h2,
          h3,
          h4,
          h5,
          h6 {

            color:
              #F1F5F9 !important;

            line-height:
              1.3 !important;

          }


          /*
           * Links
           */

          a {

            color:
              #37E29A !important;

            text-decoration:
              underline;

            text-decoration-color:
              rgba(
                55,
                226,
                154,
                0.35
              );

            text-underline-offset:
              2px;

          }


          a:hover {

            color:
              #7AF2BC !important;

          }


          /*
           * Images
           */

          img {

            max-width:
              100% !important;

            height:
              auto !important;

          }


          /*
           * Tables
           */

          table {

            max-width:
              100% !important;

            width:
              auto;

          }


          td {

            max-width:
              100% !important;

          }


          /*
           * Code
           */

          pre,
          code {

            font-family:
              "JetBrains Mono",
              ui-monospace,
              SFMono-Regular,
              Menlo,
              monospace !important;

          }


          pre {

            white-space:
              pre-wrap !important;

            word-break:
              break-word !important;

            background:
              #080B10 !important;

            color:
              #C2CCD8 !important;

            border:
              1px solid #2A3341 !important;

            border-radius:
              10px !important;

            padding:
              14px !important;

            overflow-x:
              auto !important;

          }


          code {

            background:
              #080B10 !important;

            color:
              #37E29A !important;

            border-radius:
              5px;

            padding:
              2px 5px;

          }


          /*
           * Quotes
           */

          blockquote {

            margin-left:
              0 !important;

            border-left:
              3px solid #37E29A !important;

            padding-left:
              14px !important;

            color:
              #94A3B5 !important;

          }


          /*
           * Separators
           */

          hr {

            border:
              0 !important;

            border-top:
              1px solid #2A3341 !important;

            margin:
              22px 0 !important;

          }


          /*
           * Forms
           */

          input,
          textarea,
          select,
          button {

            max-width:
              100% !important;

            background:
              #151B25 !important;

            color:
              #E7ECF1 !important;

            border:
              1px solid #2A3341 !important;

            border-radius:
              7px !important;

          }


          /*
           * Plain-text email
           */

          .plain-message {

            white-space:
              pre-wrap;

            word-break:
              break-word;

            color:
              #C2CCD8;

            font-family:
              "JetBrains Mono",
              ui-monospace,
              SFMono-Regular,
              monospace;

            font-size:
              13px;

            line-height:
              1.7;

            background:
              #0C1017;

            border:
              1px solid #2A3341;

            border-radius:
              12px;

            padding:
              18px;

          }


          /*
           * Mobile
           */

          @media (
            max-width: 640px
          ) {

            body {

              padding:
                18px !important;

            }

          }

        </style>

      </head>


      <body>

        ${body}

      </body>

      </html>

    `;

  }


  /* =========================================================================
     OPEN MESSAGE
     ========================================================================= */

  async function openMessage(
    id
  ) {

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


    /*
     * Completely sandbox the email.
     */

    el.viewerFrame.setAttribute(
      'sandbox',
      ''
    );


    el.viewerFrame.className =
      'viewer-frame';


    el.viewerFrame.srcdoc = `

      <!doctype html>

      <html>

      <body style="
        margin:0;
        min-height:420px;
        display:flex;
        align-items:center;
        justify-content:center;
        background:#10151D;
        color:#6B7A8D;
        font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        font-size:13px;
      ">

        Loading message…

      </body>

      </html>

    `;


    try {

      const message =
        await fetchMessage(
          id
        );


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
          ? message.html.join(
              ''
            )
          : message.html;


      el.viewerFrame.srcdoc =
        buildSafeMessageDocument(
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
          min-height:420px;
          padding:28px;
          background:#10151D;
          color:#FCA5A5;
          font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          font-size:13px;
          line-height:1.6;
        ">

          <strong>
            Could not load this message
          </strong>

          <p style="
            color:#94A3B5;
            margin-top:8px;
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


  /* =========================================================================
     ATTACHMENTS
     ========================================================================= */

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


        el.viewerAttachments.appendChild(
          item
        );

      }
    );


    renderIcons();

  }


  /* =========================================================================
     REFRESH MESSAGES
     ========================================================================= */

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


  /* =========================================================================
     POLLING
     ========================================================================= */

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


  /* =========================================================================
     ACTIVATE INBOX
     ========================================================================= */

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


  /* =========================================================================
     COPY
     ========================================================================= */

  async function copyAddress() {

    if (
      !state.account
    ) {

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

      } catch {

        // Ignore fallback failure.

      }


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


  /* =========================================================================
     RANDOM ADDRESS
     ========================================================================= */

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


  /* =========================================================================
     CUSTOM ADDRESS
     ========================================================================= */

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


  /* =========================================================================
     DELETE
     ========================================================================= */

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


  /* =========================================================================
     MANUAL REFRESH
     ========================================================================= */

  async function manualRefresh() {

    state.msRemaining =
      POLL_MS;


    await refreshMessages({
      silent: false,
    });

  }


  /* =========================================================================
     EVENTS
     ========================================================================= */

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


  /* =========================================================================
     BOOT
     ========================================================================= */

  async function boot() {

    renderIcons();


    bindEvents();


    setAddressLoading(
      true
    );


    /*
     * Load available domains.
     */

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
     * Create new inbox.
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


      el.addressText.textContent =
        'unavailable';


      showToast(
        error.message ||
          'Could not create a temporary inbox.',
        'error'
      );

    }

  }


  /* =========================================================================
     START
     ========================================================================= */

  document.addEventListener(
    'DOMContentLoaded',
    boot
  );

})();
