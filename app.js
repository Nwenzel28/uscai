// ==========================
// app.js  –  core chat logic
// ==========================

let currentBotIndex = 0;
let isSending = false;
let lastUserText = '';
const minimapItems = new Map();
let activeMinimapId = null;
let minimapObserver = null;

// Matches max-h-[140px] on #userInput
const COMPOSER_MAX_HEIGHT = 140;

function getChatContainer() {
    return document.getElementById('chatHistory');
}

function getChatMessageStream() {
    return document.getElementById('chatStream') || getChatContainer();
}

function setSendButtonState(disabled) {
    const btn = document.getElementById('sendBtn');
    if (!btn) return;

    btn.disabled = disabled;
    btn.classList.toggle('opacity-60', disabled);
    btn.classList.toggle('cursor-not-allowed', disabled);
    btn.setAttribute('aria-busy', String(disabled));
}

function setComposerBusy(busy) {
    const input = document.getElementById('userInput');
    if (!input) return;

    input.disabled = busy;
    setSendButtonState(busy);
}

function sanitizeRenderedHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return html;

    const forbidden = ['script', 'style', 'iframe', 'object', 'embed'];
    forbidden.forEach((tag) => root.querySelectorAll(tag).forEach((el) => el.remove()));

    root.querySelectorAll('*').forEach((el) => {
        [...el.attributes].forEach((attr) => {
            if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
        });
    });

    return root.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
    populateDropdown();
    updateBotUI();

    if (window.marked && window.markedKatex) {
        marked.use(window.markedKatex({ throwOnError: false }));
    }

    initMinimap();
    document.getElementById('chatStream').addEventListener('click', handleBubbleAction);

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

    setSendButtonState(false);
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
    currentBotIndex = Number.parseInt(document.getElementById('botSelector').value, 10) || 0;
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

function initMinimap() {
    const container = document.getElementById('conversationMinimap');
    const list = document.getElementById('minimapItems');
    if (!container || !list || !window.IntersectionObserver) return;

    minimapObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                const id = entry.target.id;
                const minItem = minimapItems.get(id);
                if (!minItem) return;

                if (entry.isIntersecting && entry.intersectionRatio > 0.35) {
                    setActiveMinimapItem(id);
                }
            });
        },
        { root: getChatContainer(), threshold: [0.15, 0.35, 0.65] }
    );
}

function setActiveMinimapItem(id) {
    if (activeMinimapId === id) return;
    if (activeMinimapId && minimapItems.has(activeMinimapId)) {
        const previous = minimapItems.get(activeMinimapId);
        previous.classList.remove('bg-cardinal', 'text-white');
        previous.classList.add('bg-white/70', 'text-stone-700');
    }
    const next = minimapItems.get(id);
    if (!next) return;
    next.classList.add('bg-cardinal', 'text-white');
    next.classList.remove('bg-white/70', 'text-stone-700');
    activeMinimapId = id;
}

function scrollToBubble(id) {
    const row = document.getElementById(id);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setActiveMinimapItem(id);
}

function registerBubbleForMinimap(row, sender, text) {
    const minimapContainer = document.getElementById('minimapItems');
    if (!minimapContainer) return;

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'h-2 rounded-full w-full bg-white/70 border border-white/30 transition-all duration-200 hover:scale-105 hover:bg-cardinal/80';
    item.title = sender === 'user' ? 'Your prompt' : sender === 'bot' ? 'AI response' : 'Conversation item';
    item.addEventListener('click', () => scrollToBubble(row.id));

    minimapItems.set(row.id, item);
    minimapContainer.appendChild(item);
    if (minimapObserver) minimapObserver.observe(row);
}

function removeMinimapItem(id) {
    const row = document.getElementById(id);
    if (row && minimapObserver) {
        minimapObserver.unobserve(row);
    }

    const item = minimapItems.get(id);
    if (item) {
        item.remove();
        minimapItems.delete(id);
    }
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

function createMessageActions(sender, id, text) {
    const position = sender === 'user' ? 'right-2 bottom-2' : 'left-2 bottom-2';
    const actions = document.createElement('div');
    actions.className = `message-actions absolute ${position} flex gap-1 rounded-full bg-white/90 px-1.5 py-1 shadow-sm transition-opacity backdrop-blur-sm ring-1 ring-stone-200 opacity-0 pointer-events-none`;
    actions.dataset.messageId = id;

    if (sender === 'user') {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'inline-flex items-center justify-center rounded-full p-1 text-stone-700 hover:bg-stone-100';
        editBtn.setAttribute('aria-label', 'Edit your message');
        editBtn.dataset.action = 'edit';
        editBtn.innerHTML = '<i class="fa-solid fa-pen fa-xs"></i>';
        actions.appendChild(editBtn);
    }

    if (sender === 'bot') {
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'inline-flex items-center justify-center rounded-full p-1 text-stone-700 hover:bg-stone-100';
        copyBtn.setAttribute('aria-label', 'Copy bot response');
        copyBtn.dataset.action = 'copy';
        copyBtn.dataset.messageText = text;
        copyBtn.innerHTML = '<i class="fa-solid fa-copy fa-xs"></i>';
        actions.appendChild(copyBtn);

        const redoBtn = document.createElement('button');
        redoBtn.type = 'button';
        redoBtn.className = 'inline-flex items-center justify-center rounded-full p-1 text-stone-700 hover:bg-stone-100';
        redoBtn.setAttribute('aria-label', 'Redo this response');
        redoBtn.dataset.action = 'redo';
        redoBtn.innerHTML = '<i class="fa-solid fa-rotate-right fa-xs"></i>';
        actions.appendChild(redoBtn);
    }

    return actions;
}

function handleBubbleAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const host = button.closest('[data-message-id]');
    const row = host ? document.getElementById(host.dataset.messageId || host.id) : null;
    if (!row) return;
    const action = button.dataset.action;

    if (action === 'edit') {
        const text = row.dataset.text;
        const botIndex = Number(row.dataset.botIndex);
        const input = document.getElementById('userInput');
        if (typeof botIndex === 'number' && !Number.isNaN(botIndex)) {
            currentBotIndex = botIndex;
            document.getElementById('botSelector').value = String(botIndex);
            updateBotUI();
        }
        if (input) {
            input.value = text;
            autoResizeInput();
            input.focus();
        }
        return;
    }

    if (action === 'copy') {
        const text = button.dataset.messageText || row.dataset.text || '';
        navigator.clipboard.writeText(text).then(
            () => showToast('Copied response'),
            () => showToast('Failed to copy')
        );
        return;
    }

    if (action === 'redo') {
        const userText = row.dataset.userText || row.dataset.replyText || '';
        const botIndex = Number(row.dataset.botIndex);
        if (!userText) return;
        if (typeof botIndex === 'number' && !Number.isNaN(botIndex)) {
            currentBotIndex = botIndex;
            document.getElementById('botSelector').value = String(botIndex);
            updateBotUI();
        }
        const input = document.getElementById('userInput');
        if (!input) return;
        input.value = userText;
        autoResizeInput();
        input.focus();
        sendMessage();
    }
}

// Send a message to the Gemini API
async function sendMessage() {
    if (isSending) return;

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

    isSending = true;
    setComposerBusy(true);
    lastUserText = userText;

    appendMessage(userText, 'user', { botIndex: currentBotIndex });
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
            const reply = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
            appendMessage(reply || 'Sorry — I could not generate a response this time.', 'bot', {
                userText,
                botIndex: currentBotIndex
            });
        } else {
            const errorMessage = data && data.error && data.error.message ? data.error.message : 'Unknown error';
            appendMessage('Error: ' + errorMessage, 'error');
        }
    } catch (err) {
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();
        appendMessage('Connection error: ' + err.message, 'error');
    } finally {
        isSending = false;
        setComposerBusy(false);
        input.focus();
    }
}

// Render a message bubble and scroll the chat into view
function appendMessage(text, sender, metadata = {}) {
    const history = getChatMessageStream();
    const container = getChatContainer();
    const id = 'bubble-' + Date.now();
    const row = document.createElement('div');
    row.id = id;
    row.dataset.messageId = id;
    row.classList.add('group', 'message-enter');

    const bot = BOT_CONFIG[currentBotIndex];
    const wrapperClasses = 'relative max-w-[85%]';
    const bubbleWrapper = document.createElement('div');
    bubbleWrapper.className = wrapperClasses;

    if (sender === 'user') {
        row.classList.add('flex', 'justify-end');
        const bubble = document.createElement('div');
        bubble.className = 'bg-stone-800 text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed whitespace-pre-wrap';
        bubble.textContent = text;
        bubbleWrapper.appendChild(bubble);
        bubbleWrapper.appendChild(createMessageActions('user', id, text));
        row.dataset.text = text;
        row.dataset.botIndex = metadata.botIndex != null ? String(metadata.botIndex) : String(currentBotIndex);
        row.appendChild(bubbleWrapper);

    } else if (sender === 'bot') {
        row.classList.add('flex', 'gap-3');
        const icon = document.createElement('div');
        icon.className = 'w-7 h-7 rounded-full bg-gold/30 flex items-center justify-center text-cardinal shrink-0 mt-0.5';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = `<i class="${bot.iconClass} text-xs"></i>`;

        const bubble = document.createElement('div');
        bubble.className = 'bg-white border border-stone-200 text-stone-800 px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed min-w-0';
        bubble.innerHTML = `<div class="prose prose-sm prose-stone max-w-none">${sanitizeRenderedHTML(marked.parse(text || ''))}</div>`;
        bubbleWrapper.appendChild(bubble);
        bubbleWrapper.appendChild(createMessageActions('bot', id, text));
        row.dataset.userText = metadata.userText || lastUserText;
        row.dataset.botIndex = metadata.botIndex != null ? String(metadata.botIndex) : String(currentBotIndex);
        row.appendChild(icon);
        row.appendChild(bubbleWrapper);

    } else if (sender === 'loading') {
        row.classList.add('flex', 'gap-3', 'animate-pulse');
        row.innerHTML = `
            <div class="w-7 h-7 rounded-full bg-stone-200 flex items-center justify-center text-stone-400 shrink-0 mt-0.5" aria-hidden="true">
                <i class="fa-solid fa-spinner animate-spin text-xs"></i>
            </div>
            <div class="bg-white border border-stone-200 text-stone-400 px-4 py-3 rounded-2xl rounded-tl-sm text-sm italic">
                ${text}
            </div>`;

    } else if (sender === 'error') {
        row.classList.add('flex', 'justify-center');
        const pill = document.createElement('div');
        pill.className = 'bg-red-50 text-red-700 border border-red-200 px-4 py-2 rounded-xl text-xs flex items-center gap-2';
        pill.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span></span>';
        pill.querySelector('span').textContent = text;
        row.appendChild(pill);
    }

    history.appendChild(row);
    if (sender === 'user' || sender === 'bot') {
        registerBubbleForMinimap(row, sender, text);
    }
    window.requestAnimationFrame(() => row.classList.add('message-enter-active'));
    container.scrollTop = container.scrollHeight;
    return id;
}
