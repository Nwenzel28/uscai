// ==========================
// app.js  –  core chat logic
// ==========================

let currentBotIndex = 0;

// Matches max-h-[140px] on #userInput
const COMPOSER_MAX_HEIGHT = 140;

document.addEventListener('DOMContentLoaded', () => {
    populateDropdown();
    updateBotUI();

    const hasKey = !!localStorage.getItem('gemini_api_key');
    const panel  = document.getElementById('settingsPanel');
    const clear  = document.getElementById('clearKeyBtn');
    const icon   = document.getElementById('settingsIcon');

    if (hasKey) {
        panel.classList.add('hidden');
        clear.classList.remove('hidden');
        icon.className = 'fa-solid fa-key text-sm text-white/40';
    } else {
        // No key yet — keep panel visible so the user knows to set one
        panel.classList.remove('hidden');
        clear.classList.add('hidden');
        icon.className = 'fa-solid fa-key text-sm text-gold/90';
    }
});

// Build the advisor dropdown from config.js
function populateDropdown() {
    const sel = document.getElementById('botSelector');
    sel.innerHTML = '';
    BOT_CONFIG.forEach((bot, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = bot.title;
        sel.appendChild(opt);
    });
}

// Sync icon + placeholder to whichever advisor is active
function updateBotUI() {
    const bot = BOT_CONFIG[currentBotIndex];
    document.getElementById('botSelectorIcon').className =
        bot.iconClass + ' absolute left-2.5 top-1/2 -translate-y-1/2 text-cardinal text-xs pointer-events-none';
    document.getElementById('welcomeIcon').className =
        bot.iconClass + ' text-xs';
    document.getElementById('userInput').placeholder =
        `Ask ${bot.title} a question…`;
}

// Switch advisors
function switchBot() {
    currentBotIndex = parseInt(document.getElementById('botSelector').value);
    updateBotUI();
    appendMessage(
        `Fight On! I'm ${BOT_CONFIG[currentBotIndex].title}. How can I help you today?`,
        'bot'
    );
}

// Toggle the settings/credentials bar
function toggleSettings() {
    const panel = document.getElementById('settingsPanel');
    const isHidden = panel.classList.toggle('hidden');
    if (!isHidden) {
        setTimeout(() => document.getElementById('apiKeyInput').focus(), 50);
    }
}

// Save key to localStorage and close the panel
function saveKey() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) {
        alert('Please paste a valid API key first.');
        return;
    }
    localStorage.setItem('gemini_api_key', key);
    document.getElementById('apiKeyInput').value = '';
    document.getElementById('settingsPanel').classList.add('hidden');
    document.getElementById('clearKeyBtn').classList.remove('hidden');
    document.getElementById('settingsIcon').className =
        'fa-solid fa-key text-sm text-white/40';
}

// Remove the key and reopen the panel — important on shared/lab computers
function clearKey() {
    if (!confirm("Remove the saved API key from this browser? You'll need to paste it again to keep chatting.")) return;
    localStorage.removeItem('gemini_api_key');
    document.getElementById('clearKeyBtn').classList.add('hidden');
    document.getElementById('settingsPanel').classList.remove('hidden');
    document.getElementById('settingsIcon').className =
        'fa-solid fa-key text-sm text-gold/90';
    setTimeout(() => document.getElementById('apiKeyInput').focus(), 50);
}

// Grow the textarea as the user types; collapse on send
function autoResizeInput() {
    const ta = document.getElementById('userInput');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, COMPOSER_MAX_HEIGHT) + 'px';
}

// Enter sends; Shift+Enter inserts a newline
function handleComposerKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

// Send a message to the Gemini API
async function sendMessage() {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        // Nudge the user to set the key rather than throwing a bare alert
        document.getElementById('settingsPanel').classList.remove('hidden');
        document.getElementById('apiKeyInput').focus();
        return;
    }

    const input    = document.getElementById('userInput');
    const userText = input.value.trim();
    if (!userText) return;

    appendMessage(userText, 'user');
    input.value = '';
    autoResizeInput();

    const loadingId = appendMessage('Thinking…', 'loading');

    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: userText }] }],
                    systemInstruction: { parts: [{ text: BOT_CONFIG[currentBotIndex].systemPrompt }] },
                    generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
                })
            }
        );

        const data = await res.json();
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();

        if (res.ok) {
            const reply = data.candidates[0].content.parts[0].text;
            appendMessage(reply, 'bot');
        } else {
            appendMessage('Error: ' + (data.error?.message ?? 'Unknown error'), 'error');
        }
    } catch (err) {
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();
        appendMessage('Connection error: ' + err.message, 'error');
    }
}

// Render a message bubble and scroll the chat into view
function appendMessage(text, sender) {
    const history = document.getElementById('chatHistory');
    const id      = 'bubble-' + Date.now();
    const row     = document.createElement('div');
    row.id = id;

    const bot = BOT_CONFIG[currentBotIndex];

    if (sender === 'user') {
        row.className = 'flex justify-end';
        const bubble = document.createElement('div');
        // Dark stone bubble for the user — cardinal is reserved for the header/brand.
        bubble.className = 'bg-stone-800 text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed whitespace-pre-wrap max-w-[85%]';
        bubble.textContent = text; // textContent: never allow raw user input to become markup
        row.appendChild(bubble);

    } else if (sender === 'bot') {
        row.className = 'flex gap-3';
        marked.use(window.markedKatex({ throwOnError: false }));
        const formatted = marked.parse(text);
        row.innerHTML = `
            <div class="w-7 h-7 rounded-full bg-gold/30 flex items-center justify-center text-cardinal shrink-0 mt-0.5" aria-hidden="true">
                <i class="${bot.iconClass} text-xs"></i>
            </div>
            <div class="bg-white border border-stone-200 text-stone-800 px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed max-w-[85%]">
                <div class="prose prose-sm prose-stone max-w-none">${formatted}</div>
            </div>`;

    } else if (sender === 'loading') {
        row.className = 'flex gap-3 animate-pulse';
        row.innerHTML = `
            <div class="w-7 h-7 rounded-full bg-stone-200 flex items-center justify-center text-stone-400 shrink-0 mt-0.5" aria-hidden="true">
                <i class="fa-solid fa-spinner animate-spin text-xs"></i>
            </div>
            <div class="bg-white border border-stone-200 text-stone-400 px-4 py-3 rounded-2xl rounded-tl-sm text-sm italic">
                ${text}
            </div>`;

    } else if (sender === 'error') {
        row.className = 'flex justify-center';
        const pill = document.createElement('div');
        pill.className = 'bg-red-50 text-red-700 border border-red-200 px-4 py-2 rounded-xl text-xs flex items-center gap-2';
        pill.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span></span>';
        pill.querySelector('span').textContent = text; // textContent: keep error text safe
        row.appendChild(pill);
    }

    history.appendChild(row);
    history.scrollTop = history.scrollHeight;
    return id;
}