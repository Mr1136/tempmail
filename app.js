// High-Speed Temporary Mail Client Engine (Optimized for GitHub Pages)
const API_URL = 'https://mail.tm';

// Hardcoded active Mail.tm domains to skip the slow domain fetch request
const FIXED_DOMAINS = ['emalupe.com', 'web-library.net', 'anymail.cc', 'mail-box.biz'];

let currentAccount = null;
let pollInterval = null;

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
async function createInstantAccount() {
    const emailDisplay = document.getElementById('email-address');
    if (emailDisplay) emailDisplay.textContent = 'Generating inbox...';

    // Pick a random domain instantly from our local list
    const randomDomain = FIXED_DOMAINS[Math.floor(Math.random() * FIXED_DOMAINS.length)];
    const username = generateRandomString(8);
    const email = `${username}@${randomDomain}`;
    const password = generateRandomString(12);

    try {
        // Register the account directly with the API
        const response = await fetch(`${API_URL}/accounts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: email, password: password })
        });

        if (!response.ok) throw new Error('Account creation failed');
        const accountData = await response.json();

        // Log in to get the security access token
        const tokenResponse = await fetch(`${API_URL}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: email, password: password })
        });

        if (!tokenResponse.ok) throw new Error('Authentication failed');
        const tokenData = await tokenResponse.json();

        // Store account and token details in memory
        currentAccount = {
            ...accountData,
            token: tokenData.token,
            password: password
        };

        // Update the screen display instantly
        if (emailDisplay) emailDisplay.textContent = currentAccount.address;
        
        // Start high-speed mailbox monitoring
        startHighSpeedPolling();

    } catch (error) {
        console.error('Error:', error);
        if (emailDisplay) emailDisplay.textContent = 'Error. Click Refresh.';
    }
}

// HIGH-SPEED INBOX POLLING (Checks for new emails every 3 seconds instead of 10)
function startHighSpeedPolling() {
    if (pollInterval) clearInterval(pollInterval);
    
    // Check once immediately on load
    checkMailbox();
    
    // Poll the servers rapidly every 3 seconds for instant arrivals
    pollInterval = setInterval(checkMailbox, 3000); 
}

async function checkMailbox() {
    if (!currentAccount) return;
    
    try {
        const response = await fetch(`${API_URL}/messages`, {
            headers: { 'Authorization': `Bearer ${currentAccount.token}` }
        });
        
        if (!response.ok) return;
        const data = await response.json();
        
        // Render emails dynamically to your HTML view layer
        updateInboxUI(data['hydra:member']);
    } catch (error) {
        console.error('Inbox sync error:', error);
    }
}

function updateInboxUI(messages) {
    const inboxList = document.getElementById('inbox-list');
    if (!inboxList) return;

    if (messages.length === 0) {
        inboxList.innerHTML = '<div class="text-center p-8 text-zinc-500">Waiting for incoming emails...</div>';
        return;
    }

    inboxList.innerHTML = '';
    messages.forEach(msg => {
        const item = document.createElement('div');
        item.className = 'p-4 border-b border-zinc-800 hover:bg-zinc-900 cursor-pointer transition';
        item.innerHTML = `
            <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-sm text-zinc-200">${msg.from.name || msg.from.address}</span>
                <span class="text-xs text-zinc-500">${new Date(msg.createdAt).toLocaleTimeString()}</span>
            </div>
            <div class="text-xs font-semibold text-indigo-400 mb-1">${msg.subject || '(No Subject)'}</div>
            <div class="text-xs text-zinc-400 truncate">${msg.intro || ''}</div>
        `;
        inboxList.appendChild(item);
    });
}

// Initialise the high-speed system on page execution
document.addEventListener('DOMContentLoaded', createInstantAccount);
