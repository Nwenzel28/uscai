// ==========================
// app.js  –  core chat logic
// ==========================

let currentBotIndex = 0;
let isSending = false;
let conversationHistory = []; // Gemini-format turns: {role:'user'|'model', parts:[{text}]}. Resets on bot switch / clear.
let bubbleCounter = 0; // guarantees unique bubble ids even when two bubbles are appended in the same millisecond
let confirmAction = null; // callback wired up by showConfirm(), run by the modal's action button
let hasInteracted = false; // true once the user has sent at least one message this session (drives Clear button state)

// Matches max-h-[140px] on #userInput
const COMPOSER_MAX_HEIGHT = 140;
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

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

// Small helper: show/hide a "pop" panel with the enter transition, keeping only one open at a time
function openPanel(el) {
    el.classList.remove('hidden');
    requestAnimationFrame(() => el.classList.add('pop-enter-active'));
}
function closePanel(el) {
    el.classList.remove('pop-enter-active');
    setTimeout(() => el.classList.add('hidden'), 120);
}

function setButtonEnabled(btn, enabled) {
    btn.disabled = !enabled;
    btn.classList.toggle('opacity-30', !enabled);
    btn.classList.toggle('cursor-not-allowed', !enabled);
}

// Clear chat only needs *something on screen* to be worth resetting.
// Save chat needs an actual recorded exchange, since that's what gets exported.
function updateChatActionButtons() {
    setButtonEnabled(document.getElementById('clearChatBtn'), hasInteracted);
    setButtonEnabled(document.getElementById('saveChatBtn'), conversationHistory.length > 0);
}

document.addEventListener('DOMContentLoaded', () => {
    populateBotPicker();
    updateBotUI();
    refreshKeyState();

    if (window.marked && window.markedKatex) {
        marked.use(window.markedKatex({ throwOnError: false }));
    }

    setSendButtonState(false);
    updateChatActionButtons();

    // No key saved yet — open the popup automatically so setup is the first thing you see
    if (!localStorage.getItem('gemini_api_key')) {
        setTimeout(openKeyPopup, 300); // let the entrance animations settle first
    }

    // Close open panels on outside click
    document.addEventListener('click', (e) => {
        const botWrap = document.getElementById('botPickerWrap');
        const botMenu = document.getElementById('botPickerMenu');
        if (!botMenu.classList.contains('hidden') && !botWrap.contains(e.target)) {
            closeBotPicker();
        }

        const keyPopup = document.getElementById('keyPopup');
        const settingsBtn = document.getElementById('settingsBtn');
        if (!keyPopup.classList.contains('hidden') && !keyPopup.contains(e.target) && e.target !== settingsBtn && !settingsBtn.contains(e.target)) {
            closeKeyPopup();
        }
    });

    // Escape closes whatever's open, most-specific first. Alt+1..9 jumps straight to an advisor.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!document.getElementById('confirmOverlay').classList.contains('hidden')) { hideConfirm(); return; }
            if (!document.getElementById('keyPopup').classList.contains('hidden')) { closeKeyPopup(); return; }
            if (!document.getElementById('botPickerMenu').classList.contains('hidden')) { closeBotPicker(); return; }
            return;
        }

        if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
            const i = Number(e.key) - 1;
            if (i < BOT_CONFIG.length) {
                e.preventDefault();
                selectBot(i);
            }
        }
    });

    // Capture pastes into the invisible key field directly
    const input = document.getElementById('apiKeyInput');
    input.addEventListener('paste', (e) => {
        const pasted = (e.clipboardData || window.clipboardData).getData('text').trim();
        e.preventDefault();
        if (!pasted) return;

        localStorage.setItem('gemini_api_key', pasted);
        input.value = '';

        // brief confirmation flash on both glyphs before the popup closes itself
        setKeySymbolActive(document.getElementById('cmdKeySymbol'), true);
        setKeySymbolActive(document.getElementById('vKeySymbol'), true);
        refreshKeyState();
        setTimeout(closeKeyPopup, 220);
    });
});

// ---------------------------------------------------------------------------
// Bot picker (custom dropdown)
// ---------------------------------------------------------------------------

function populateBotPicker() {
    const menu = document.getElementById('botPickerMenu');
    menu.innerHTML = '';
    BOT_CONFIG.forEach((bot, i) => {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.setAttribute('role', 'option');
        opt.setAttribute('aria-selected', String(i === currentBotIndex));
        opt.className = 'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-stone-50 transition';
        opt.onclick = () => selectBot(i);

        opt.innerHTML = `
            <i class="${bot.iconClass} text-cardinal text-xs w-4 text-center shrink-0" aria-hidden="true"></i>
            <span class="flex-grow text-stone-700 truncate">${bot.title}</span>
            ${i < 9 ? `<span class="text-[10px] text-stone-300 font-mono shrink-0" aria-hidden="true">⌥${i + 1}</span>` : ''}
            <i class="fa-solid fa-check text-cardinal text-xs shrink-0 ${i === currentBotIndex ? '' : 'invisible'}" aria-hidden="true"></i>`;
        menu.appendChild(opt);
    });
}

function toggleBotPicker() {
    const menu = document.getElementById('botPickerMenu');
    if (menu.classList.contains('hidden')) {
        closeKeyPopup();
        openBotPicker();
    } else {
        closeBotPicker();
    }
}

function openBotPicker() {
    const menu = document.getElementById('botPickerMenu');
    const btn  = document.getElementById('botPickerBtn');
    openPanel(menu);
    btn.setAttribute('aria-expanded', 'true');
    document.getElementById('botPickerChevron').classList.add('rotate-180');
}

function closeBotPicker() {
    const menu = document.getElementById('botPickerMenu');
    const btn  = document.getElementById('botPickerBtn');
    closePanel(menu);
    btn.setAttribute('aria-expanded', 'false');
    document.getElementById('botPickerChevron').classList.remove('rotate-180');
}

function selectBot(i) {
    currentBotIndex = i;
    conversationHistory = []; // new advisor, new context
    hasInteracted = false;
    updateBotUI();
    populateBotPicker(); // refresh checkmarks
    closeBotPicker();
    updateChatActionButtons();
    appendMessage(
        `Fight On! I'm ${BOT_CONFIG[currentBotIndex].title}. How can I help you today?`,
        'bot'
    );
}

// Sync icon + label + placeholder to whichever advisor is active
function updateBotUI() {
    const bot = BOT_CONFIG[currentBotIndex];
    document.getElementById('botSelectorIcon').className = bot.iconClass + ' text-cardinal text-xs shrink-0';
    document.getElementById('botPickerLabel').textContent = bot.title;
    document.getElementById('welcomeIcon').className = bot.iconClass + ' text-xs';
    document.getElementById('userInput').placeholder = `Ask ${bot.title} a question…`;
}

// ---------------------------------------------------------------------------
// API key popup (press Cmd/Ctrl + V to paste — no visible text field)
// ---------------------------------------------------------------------------

function refreshKeyState() {
    const hasKey = !!localStorage.getItem('gemini_api_key');
    const clearBtn = document.getElementById('clearKeyBtn');
    const icon = document.getElementById('settingsIcon');
    clearBtn.classList.toggle('hidden', !hasKey);
    icon.className = hasKey ? 'fa-solid fa-key text-sm text-white/40' : 'fa-solid fa-key text-sm text-gold/90';
}

function toggleKeyPopup() {
    const popup = document.getElementById('keyPopup');
    if (popup.classList.contains('hidden')) {
        closeBotPicker();
        openKeyPopup();
    } else {
        closeKeyPopup();
    }
}

function openKeyPopup() {
    const popup = document.getElementById('keyPopup');
    const input = document.getElementById('apiKeyInput');
    document.getElementById('keyHint').textContent = (IS_MAC ? 'Cmd' : 'Ctrl') + ' + V to paste';
    document.getElementById('cmdKeySymbol').textContent = IS_MAC ? '⌘' : 'Ctrl';

    openPanel(popup);
    document.getElementById('settingsBtn').setAttribute('aria-expanded', 'true');

    input.value = '';
    setTimeout(() => input.focus(), 60);

    window.addEventListener('keydown', handleKeySymbolDown);
    window.addEventListener('keyup', handleKeySymbolUp);
}

function closeKeyPopup() {
    const popup = document.getElementById('keyPopup');
    closePanel(popup);
    document.getElementById('settingsBtn').setAttribute('aria-expanded', 'false');
    resetKeySymbols();
    window.removeEventListener('keydown', handleKeySymbolDown);
    window.removeEventListener('keyup', handleKeySymbolUp);
}

// Toggle a glyph's active state. Color is swapped via Tailwind's own class
// (rather than a custom CSS class) so it isn't at the mercy of stylesheet
// injection order — Tailwind's CDN build injects its rules after our inline
// <style> block, so a same-specificity custom class was silently losing.
function setKeySymbolActive(el, active) {
    el.classList.toggle('key-symbol-active', active); // scale only
    el.classList.toggle('text-gold', active);
    el.classList.toggle('text-stone-300', !active);
}

function resetKeySymbols() {
    setKeySymbolActive(document.getElementById('cmdKeySymbol'), false);
    setKeySymbolActive(document.getElementById('vKeySymbol'), false);
}

// Light up the Cmd/Ctrl and V glyphs while they're actually held down
function handleKeySymbolDown(e) {
    if (e.key === 'Meta' || e.key === 'Control') {
        setKeySymbolActive(document.getElementById('cmdKeySymbol'), true);
    }
    if (e.key && e.key.toLowerCase() === 'v') {
        setKeySymbolActive(document.getElementById('vKeySymbol'), true);
    }
}
function handleKeySymbolUp(e) {
    if (e.key === 'Meta' || e.key === 'Control') {
        setKeySymbolActive(document.getElementById('cmdKeySymbol'), false);
    }
    if (e.key && e.key.toLowerCase() === 'v') {
        setKeySymbolActive(document.getElementById('vKeySymbol'), false);
    }
}

function requestClearKey() {
    showConfirm(
        "Remove the saved API key from this browser? You'll need to paste it again to keep chatting.",
        'Remove key',
        () => {
            localStorage.removeItem('gemini_api_key');
            refreshKeyState();
        }
    );
}

// ---------------------------------------------------------------------------
// Chat clearing
// ---------------------------------------------------------------------------

function clearChat() {
    showConfirm('Clear this conversation? This cannot be undone.', 'Clear chat', () => {
        conversationHistory = [];
        hasInteracted = false;
        getChatMessageStream().innerHTML = '';
        updateChatActionButtons();
        appendMessage(
            `Fight On! I'm ${BOT_CONFIG[currentBotIndex].title}. How can I help you today?`,
            'bot'
        );
        document.getElementById('userInput').focus();
    });
}

// ---------------------------------------------------------------------------
// Save chat — renders a clean, branded transcript into a print-only container
// and hands off to the browser's native print dialog (Save as PDF works
// everywhere without pulling in a PDF-generation library over the network).
// ---------------------------------------------------------------------------

function saveChat() {
    if (conversationHistory.length === 0) return;

    const bot = BOT_CONFIG[currentBotIndex];
    const container = document.getElementById('printTranscript');
    container.innerHTML = '';

    const now = new Date();
    const header = document.createElement('div');
    header.className = 'print-doc-header';
    header.innerHTML = `
        <div class="print-doc-title">USC Viterbi — Discover Engineering</div>
        <div class="print-doc-subtitle">${bot.title} · Conversation Transcript</div>
        <div class="print-doc-meta">${now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} at ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>`;
    container.appendChild(header);

    conversationHistory.forEach((turn) => {
        const text = (turn.parts && turn.parts[0] && turn.parts[0].text) || '';
        const block = document.createElement('div');
        block.className = 'print-turn';

        const role = document.createElement('div');
        role.className = turn.role === 'user' ? 'print-role print-role-user' : 'print-role print-role-bot';
        role.textContent = turn.role === 'user' ? 'You' : bot.title;
        block.appendChild(role);

        const body = document.createElement('div');
        body.className = 'print-body';
        if (turn.role === 'user') {
            body.textContent = text; // plain text: never render raw user input as markup
        } else {
            body.innerHTML = sanitizeRenderedHTML(marked.parse(text));
        }
        block.appendChild(body);

        container.appendChild(block);
    });

    window.print();
}

// ---------------------------------------------------------------------------
// Integrated confirm modal (replaces native window.confirm())
// ---------------------------------------------------------------------------

function showConfirm(message, actionLabel, onConfirm) {
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmActionBtn').textContent = actionLabel || 'Confirm';
    confirmAction = onConfirm;

    const card = document.getElementById('confirmCard');
    document.getElementById('confirmOverlay').classList.remove('hidden');
    requestAnimationFrame(() => card.classList.add('pop-enter-active'));
}

function hideConfirm() {
    const overlay = document.getElementById('confirmOverlay');
    const card = document.getElementById('confirmCard');
    card.classList.remove('pop-enter-active');
    setTimeout(() => overlay.classList.add('hidden'), 120);
    confirmAction = null;
}

function runConfirmedAction() {
    const action = confirmAction;
    hideConfirm();
    if (action) action();
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

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
    if (isSending) return;

    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        // Nudge the user to set the key rather than throwing a bare alert
        openKeyPopup();
        return;
    }

    const input    = document.getElementById('userInput');
    const userText = input.value.trim();
    if (!userText) return;

    isSending = true;
    setComposerBusy(true);

    appendMessage(userText, 'user');
    hasInteracted = true;
    updateChatActionButtons();
    input.value = '';
    autoResizeInput();

    // Add the new turn to memory *before* the call so the model sees it as part of the thread
    conversationHistory.push({ role: 'user', parts: [{ text: userText }] });

    const loadingId = appendMessage('Thinking…', 'loading');

    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: conversationHistory,
                    systemInstruction: { parts: [{ text: BOT_CONFIG[currentBotIndex].systemPrompt }] },
                    generationConfig: { maxOutputTokens: 800, temperature: 0.7 }
                })
            }
        );

        const data = await res.json();
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();

        if (res.ok) {
            const reply = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
            if (reply) {
                conversationHistory.push({ role: 'model', parts: [{ text: reply }] });
                appendMessage(reply, 'bot');
            } else {
                conversationHistory.pop(); // no reply came back — don't leave a dangling user turn in memory
                appendMessage('Sorry — I could not generate a response this time.', 'bot');
            }
        } else {
            conversationHistory.pop(); // call failed — don't poison future turns with an unanswered message
            const errorMessage = data && data.error && data.error.message ? data.error.message : 'Unknown error';
            appendMessage('Error: ' + errorMessage, 'error');
        }
    } catch (err) {
        conversationHistory.pop();
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();
        appendMessage('Connection error: ' + err.message, 'error');
    } finally {
        isSending = false;
        setComposerBusy(false);
        updateChatActionButtons();
        input.focus();
    }
}

// Render a message bubble and scroll the chat into view
function appendMessage(text, sender) {
    const history = getChatMessageStream();
    const container = getChatContainer();
    const id      = 'bubble-' + (bubbleCounter++);
    const row     = document.createElement('div');
    row.id = id;

    const bot = BOT_CONFIG[currentBotIndex];

    if (sender === 'user') {
        row.className = 'flex justify-end message-enter message-enter-user';
        const bubble = document.createElement('div');
        // Dark stone bubble for the user — cardinal is reserved for the header/brand.
        bubble.className = 'bg-stone-800 text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed whitespace-pre-wrap max-w-[85%]';
        bubble.textContent = text; // textContent: never allow raw user input to become markup
        row.appendChild(bubble);

    } else if (sender === 'bot') {
        row.className = 'flex gap-3 message-enter message-enter-bot';
        const formatted = sanitizeRenderedHTML(marked.parse(text || ''));
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
    requestAnimationFrame(() => row.classList.add('message-enter-active'));
    container.scrollTop = container.scrollHeight;
    return id;
}