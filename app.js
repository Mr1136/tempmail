// High-Speed Temporary Mail Client Engine (Optimized for Vanish)
const API_URL = 'https://mail.tm';

// Hardcoded active Mail.tm domains to skip the slow domain fetch request
const FIXED_DOMAINS = ['emalupe.com', 'web-library.net', 'anymail.cc', 'mail-box.biz'];

let currentAccount = null;
let pollInterval = null;
let countdownTime = 3.5;
let countdownInterval = null;

// Generate a random username string
function generateRandomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// INSTANT ACCOUNT CREATION (Bypasses the slow domain fetch network request)
async function createInstantAccount(customPrefix = null) {
    const addressText = document.getElementById('address-text');
    const addressSkeleton = document.getElementById('address-skeleton');
    const inboxContainer = document.getElementById('inbox-container');

    if (addressText) addressText.textContent = 'generating@…';
    if (addressSkeleton) addressSkeleton.classList.remove('hidden');
    if (inboxContainer) {
        inboxContainer.innerHTML = `
            <div class="text-center p-8 text-ink-400">
                <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-signal mb-2"></div>
                <p class="text-sm">Creating secure anonymous mail routing...</p>
            </div>`;
    }

    // Pick a domain instantly from our local list or select box
    const selectDomain = document.getElementById('select-domain');
    const chosenDomain = (selectDomain && selectDomain.value && selectDomain.value !== 'loading…') 
        ? selectDomain.value 
        : FIXED_DOMAINS[Math.floor(Math.random() * FIXED_DOMAINS.length)];
    
    const username = customPrefix ? customPrefix.toLowerCase().trim() : generateRandomString(8);
    const email = `${username}@${chosenDomain}`;
    const password = generateRandomString(12);

    try {
        // Register the account directly with the API
        const response = await fetch(`${API_URL}/accounts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: email, password: password })
        });

        if (!response.ok) throw new Error('Account registration dropped by API network');
        const accountData = await response.json();

        // Log in to get the security access token
        const tokenResponse = await fetch(`${API_URL}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: email, password: password })
        });

        if (!tokenResponse.ok) throw new Error('Security token authentication rejection');
        const tokenData = await tokenResponse.json();

        // Store account parameters in memory
        currentAccount = {
            ...accountData,
            token: tokenData.token,
            password: password
        };

        // Update display layers smoothly
        if (addressText) addressText.textContent = currentAccount.address;
        if (addressSkeleton) addressSkeleton.classList.add('hidden');
        
        // Start rapid background polling mechanics
        startHighSpeedPolling();

    } catch (error) {
        console.error('Error:', error);
        if (addressText) addressText.textContent = 'Timeout. Click Refresh.';
        if (addressSkeleton) addressSkeleton.classList.add('hidden');
        if (inboxContainer) {
            inboxContainer.innerHTML = `
                <p class="text-sm text-red-400">Connection blocked. Click Sync Mail to retry.</p>`;
        }
    }
}

// DOMAIN DROPDOWN POPULATOR
function populateDomains() {
    const selectDomain = document.getElementById('select-domain');
    if (!selectDomain) return;
    
    selectDomain.innerHTML = '';
    FIXED_DOMAINS.forEach(domain => {
        const option = document.createElement('option');
        option.value = domain;
        option.textContent = domain;
        option.className = "bg-ink-950 text-ink-100";
        selectDomain.appendChild(option);
    });
}

// HIGH-SPEED INBOX MONITORING (Ticks down every 3.5 seconds)
function startHighSpeedPolling() {
    if (pollInterval) clearInterval(pollInterval);
    if (countdownInterval) clearInterval(countdownInterval);
    
    checkMailbox();
    
    pollInterval = setInterval(checkMailbox, 3500);
    
    // Smooth visual countdown sync tracker text routine
    const syncCounter = document.getElementById('sync-counter');
    countdownTime = 3.5;
    countdownInterval = setInterval(() => {
        countdownTime -= 0.1;
        if (countdownTime <= 0) countdownTime = 3.5;
        if (syncCounter) syncCounter.textContent = `Checking in ${countdownTime.toFixed(1)}s`;
    }, 100);
}

async function checkMailbox() {
    if (!currentAccount) return;
    
    try {
        const response = await fetch(`${API_URL}/messages`, {
            headers: { 'Authorization': `Bearer ${currentAccount.token}` }
        });
        
        if (!response.ok) return;
        const data = await response.json();
        updateInboxUI(data['hydra:member']);
    } catch (error) {
        console.error('Inbox sync error:', error);
    }
}

function updateInboxUI(messages) {
    const inboxContainer = document.getElementById('inbox-container');
    if (!inboxContainer) return;

    if (messages.length === 0) {
        inboxContainer.className = "divide-y divide-ink-800/50 min-h-[320px] flex flex-col items-center justify-center text-center p-8";
        inboxContainer.innerHTML = `
            <div class="relative h-12 w-12 rounded-full border border-dashed border-ink-700 flex items-center justify-center mb-3 animate-pulse">
              <i data-lucide="mail-open" class="h-5 w-5 text-ink-500"></i>
            </div>
            <p class="text-sm font-medium text-ink-300">Awaiting your incoming network messages...</p>
            <p class="text-xs text-ink-500 mt-1">Send an account authentication query or test payload directly here.</p>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    // Set structure class for card stream rendering
    inboxContainer.className = "divide-y divide-ink-800/50 min-h-[320px] flex flex-col justify-start text-left";
    inboxContainer.innerHTML = '';
    
    messages.forEach(msg => {
        const item = document.createElement('div');
        item.className = 'msg-item p-5 hover:bg-ink-900/40 cursor-pointer transition border-b border-ink-800/40 last:border-b-0 flex flex-col gap-1';
        item.innerHTML = `
            <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-ink-200 text-sm">${msg.from.name || msg.from.address}</span>
                <span class="text-xs text-ink-500">${new Date(msg.createdAt).toLocaleTimeString()}</span>
            </div>
            <div class="text-sm font-semibold text-signal mb-1">${msg.subject || '(No Subject)'}</div>
            <div class="text-xs text-ink-400 line-clamp-2 msg-snippet">${msg.intro || ''}</div>
        `;
        inboxContainer.appendChild(item);
    });
}

// CLIPBOARD ACTION CORE MECHANIC
function copyAddress() {
    const addressText = document.getElementById('address-text').textContent;
    if (addressText === 'generating@…' || addressText.includes('Timeout')) return;
    
    navigator.clipboard.writeText(addressText).then(() => {
        const box = document.getElementById('address-box');
        const tooltip = document.getElementById('copy-tooltip');
        
        if (box) box.classList.add('flash-copied');
        if (tooltip) tooltip.classList.add('show');
        
        setTimeout(() => {
            if (box) box.classList.remove('flash-copied');
            if (tooltip) tooltip.classList.remove('show');
        }, 2000);
    });
}

// CONTROL EVENT BINDING MOUNT LAYER
document.addEventListener('DOMContentLoaded', () => {
    populateDomains();
    createInstantAccount();

    // Map hardware event triggers
    document.getElementById('btn-copy')?.addEventListener('click', copyAddress);
    document.getElementById('btn-refresh')?.addEventListener('click', checkMailbox);
    document.getElementById('btn-change')?.addEventListener('click', () => createInstantAccount());
    document.getElementById('btn-delete')?.addEventListener('click', () => createInstantAccount());
    
    document.getElementById('btn-create-custom')?.addEventListener('click', () => {
        const prefix = document.getElementById('input-prefix')?.value;
        if (prefix) createInstantAccount(prefix);
    });
});
