// ==========================
// app.js  –  core chat logic
// ==========================

let currentBotIndex = 0;
let isSending = false;
let conversationHistory = []; // Gemini-format turns: {role:'user'|'model', parts:[{text}]}. Resets on bot switch / clear.
let bubbleCounter = 0; // guarantees unique bubble ids even when two bubbles are appended in the same millisecond
let confirmAction = null; // callback wired up by showConfirm(), run by the modal's action button
let hasInteracted = false; // true once the user has sent at least one message this session (drives Clear button state)
let activeAbortController = null; // lets the Stop button cancel an in-flight streaming request
let lastUserText = null; // the most recently sent user message, kept around for Retry / Regenerate
let stickToBottom = true; // whether new messages should auto-scroll (false once the user scrolls up to read history)

// Matches max-h-[140px] on #userInput
const COMPOSER_MAX_HEIGHT = 140;
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

function getChatContainer() {
    return document.getElementById('chatHistory');
}

function getChatMessageStream() {
    return document.getElementById('chatStream') || getChatContainer();
}

// ---------------------------------------------------------------------------
// Send / Stop button (same physical button, two modes)
// ---------------------------------------------------------------------------

function setSendButtonMode(mode) {
    // mode: 'send' | 'stop'
    const btn = document.getElementById('sendBtn');
    const icon = document.getElementById('sendBtnIcon');
    if (!btn || !icon) return;

    if (mode === 'stop') {
        icon.className = 'fa-solid fa-stop text-xs';
        btn.setAttribute('aria-label', 'Stop generating');
        btn.setAttribute('title', 'Stop generating');
        btn.classList.remove('bg-stone-800', 'hover:bg-stone-900');
        btn.classList.add('bg-cardinal', 'hover:bg-cardinal-10k');
    } else {
        icon.className = 'fa-solid fa-paper-plane text-xs';
        btn.setAttribute('aria-label', 'Send message');
        btn.setAttribute('title', 'Send message');
        btn.classList.remove('bg-cardinal', 'hover:bg-cardinal-10k');
        btn.classList.add('bg-stone-800', 'hover:bg-stone-900');
    }
}

function handleSendButtonClick() {
    if (isSending) {
        stopGeneration();
    } else {
        sendMessage();
    }
}

function stopGeneration() {
    if (activeAbortController) {
        activeAbortController.abort();
    }
}

function setComposerBusy(busy) {
    const input = document.getElementById('userInput');
    if (!input) return;

    input.disabled = busy;
    // The button itself stays enabled while busy — it becomes the Stop control.
    document.getElementById('sendBtn').disabled = false;
    setSendButtonMode(busy ? 'stop' : 'send');
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

    setSendButtonMode('send');
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

    // Escape closes whatever's open, most-specific first; also cancels an in-flight reply.
    // Alt+1..9 jumps straight to an advisor.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!document.getElementById('confirmOverlay').classList.contains('hidden')) { hideConfirm(); return; }
            if (!document.getElementById('keyPopup').classList.contains('hidden')) { closeKeyPopup(); return; }
            if (!document.getElementById('botPickerMenu').classList.contains('hidden')) { closeBotPicker(); return; }
            if (isSending) { stopGeneration(); return; }
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
    if (isSending) stopGeneration();
    currentBotIndex = i;
    conversationHistory = []; // new advisor, new context
    hasInteracted = false;
    lastUserText = null;
    updateBotUI();
    populateBotPicker(); // refresh checkmarks
    closeBotPicker();
    updateChatActionButtons();
    getChatMessageStream().innerHTML = '';
    appendStaticMessage(
        `Fight On! I'm ${BOT_CONFIG[currentBotIndex].title}. How can I help you today?`
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
        if (isSending) stopGeneration();
        conversationHistory = [];
        hasInteracted = false;
        lastUserText = null;
        getChatMessageStream().innerHTML = '';
        updateChatActionButtons();
        appendStaticMessage(
            `Fight On! I'm ${BOT_CONFIG[currentBotIndex].title}. How can I help you today?`
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

// ---------------------------------------------------------------------------
// Scroll tracking — auto-follow new messages only while the user is already
// near the bottom; otherwise leave their scroll position alone and surface
// the "scroll to latest" button instead.
// ---------------------------------------------------------------------------

function isNearBottom(container, thresholdPx = 80) {
    return container.scrollHeight - container.scrollTop - container.clientHeight < thresholdPx;
}

function handleChatScroll() {
    const container = getChatContainer();
    stickToBottom = isNearBottom(container);
    document.getElementById('scrollToBottomBtn').classList.toggle('visible', !stickToBottom);
}

function scrollChatToBottom(force = false) {
    const container = getChatContainer();
    if (force) stickToBottom = true;
    if (!stickToBottom) return;
    container.scrollTop = container.scrollHeight;
    document.getElementById('scrollToBottomBtn').classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Sending messages — streams the reply token-by-token from Gemini so the
// response appears progressively instead of arriving all at once.
// ---------------------------------------------------------------------------

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

    appendMessage(userText, 'user');
    hasInteracted = true;
    updateChatActionButtons();
    input.value = '';
    autoResizeInput();

    // Add the new turn to memory *before* the call so the model sees it as part of the thread
    conversationHistory.push({ role: 'user', parts: [{ text: userText }] });
    lastUserText = userText;

    await requestBotReply(apiKey);
}

// Regenerate: drop the last model turn (if any) and re-ask with the same history.
function regenerateLastResponse() {
    if (isSending) return;
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) { openKeyPopup(); return; }
    if (conversationHistory.length === 0) return;

    const last = conversationHistory[conversationHistory.length - 1];
    if (last.role === 'model') {
        conversationHistory.pop();
        const lastBotRow = getChatMessageStream().querySelector('.msg-row-bot:last-of-type');
        if (lastBotRow) lastBotRow.remove();
    }

    requestBotReply(apiKey);
}

// Retry: the previous attempt never made it into history (failed calls pop their turn),
// so just re-send the last user message.
function retryLastMessage() {
    if (isSending || !lastUserText) return;
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) { openKeyPopup(); return; }

    conversationHistory.push({ role: 'user', parts: [{ text: lastUserText }] });
    requestBotReply(apiKey);
}

// Shared streaming call used by send / regenerate / retry
async function requestBotReply(apiKey) {
    isSending = true;
    setComposerBusy(true);

    const stream = beginBotStream();
    activeAbortController = new AbortController();

    let fullText = '';
    let sawAnyText = false;

    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:streamGenerateContent?alt=sse&key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: activeAbortController.signal,
                body: JSON.stringify({
                    contents: conversationHistory,
                    systemInstruction: { parts: [{ text: BOT_CONFIG[currentBotIndex].systemPrompt }] },
                    generationConfig: { maxOutputTokens: 800, temperature: 0.7 }
                })
            }
        );

        if (!res.ok || !res.body) {
            let message = 'Unknown error';
            try {
                const data = await res.json();
                message = (data && data.error && data.error.message) || message;
            } catch (_) { /* body wasn't JSON — keep default message */ }

            if (res.status === 429) {
                message = "You're sending messages a little too fast. Wait a few seconds and try again.";
            }

            conversationHistory.pop(); // call failed — don't poison future turns with an unanswered message
            failBotStream(stream, message, /* offerRetry */ true);
            return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop(); // last chunk may be incomplete — keep it for the next read

            for (const evt of events) {
                const line = evt.split('\n').find((l) => l.startsWith('data:'));
                if (!line) continue;
                const jsonStr = line.slice(5).trim();
                if (!jsonStr) continue;

                try {
                    const parsed = JSON.parse(jsonStr);
                    const piece = parsed && parsed.candidates && parsed.candidates[0]
                        && parsed.candidates[0].content && parsed.candidates[0].content.parts
                        && parsed.candidates[0].content.parts[0] && parsed.candidates[0].content.parts[0].text;
                    if (piece) {
                        fullText += piece;
                        sawAnyText = true;
                        updateBotStream(stream, fullText);
                    }
                } catch (_) { /* ignore partial/malformed SSE frames */ }
            }
        }

        if (sawAnyText) {
            conversationHistory.push({ role: 'model', parts: [{ text: fullText }] });
            finalizeBotStream(stream, fullText);
        } else {
            conversationHistory.pop();
            failBotStream(stream, 'Sorry — I could not generate a response this time.', true);
        }
    } catch (err) {
        if (err && err.name === 'AbortError') {
            // User hit Stop: keep whatever text streamed in so far as the final answer,
            // rather than throwing it away.
            if (sawAnyText) {
                conversationHistory.push({ role: 'model', parts: [{ text: fullText }] });
                finalizeBotStream(stream, fullText, /* wasStopped */ true);
            } else {
                conversationHistory.pop();
                stream.row.remove();
            }
        } else {
            conversationHistory.pop();
            failBotStream(stream, 'Connection error: ' + err.message, true);
        }
    } finally {
        activeAbortController = null;
        isSending = false;
        setComposerBusy(false);
        updateChatActionButtons();
        document.getElementById('userInput').focus();
    }
}

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------

function formatTimestamp(date) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Plain, non-streaming messages: the welcome line and the "switched advisor" greeting
function appendStaticMessage(text) {
    appendMessage(text, 'bot-static');
}

// Render a message bubble and scroll the chat into view (user bubbles, static bot lines, errors)
function appendMessage(text, sender) {
    const history = getChatMessageStream();
    const container = getChatContainer();
    const id  = 'bubble-' + (bubbleCounter++);
    const row = document.createElement('div');
    row.id = id;

    const bot = BOT_CONFIG[currentBotIndex];
    const now = formatTimestamp(new Date());

    if (sender === 'user') {
        row.className = 'msg-row flex justify-end message-enter message-enter-user';
        row.innerHTML = `
            <div class="flex flex-col items-end max-w-[85%]">
                <div class="bg-stone-800 text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed whitespace-pre-wrap"></div>
                <span class="msg-timestamp text-[10px] text-stone-400 mt-1 mr-1">${now}</span>
            </div>`;
        row.querySelector('div.bg-stone-800').textContent = text; // textContent: never allow raw user input to become markup

    } else if (sender === 'bot-static') {
        row.className = 'msg-row msg-row-bot flex gap-3 message-enter message-enter-bot';
        const formatted = sanitizeRenderedHTML(marked.parse(text || ''));
        row.innerHTML = `
            <div class="w-7 h-7 rounded-full bg-gold/30 flex items-center justify-center text-cardinal shrink-0 mt-0.5" aria-hidden="true">
                <i class="${bot.iconClass} text-xs"></i>
            </div>
            <div class="flex flex-col max-w-[85%]">
                <div class="bg-white border border-stone-200 text-stone-800 px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed">
                    <div class="prose prose-sm prose-stone max-w-none">${formatted}</div>
                </div>
                <span class="msg-timestamp text-[10px] text-stone-400 mt-1 ml-1">${now}</span>
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
    scrollChatToBottom();
    return id;
}

// --- Streaming bot bubble lifecycle: begin -> update (many times) -> finalize/fail ---

function beginBotStream() {
    const history = getChatMessageStream();
    const bot = BOT_CONFIG[currentBotIndex];
    const id = 'bubble-' + (bubbleCounter++);

    const row = document.createElement('div');
    row.id = id;
    row.className = 'msg-row msg-row-bot flex gap-3 message-enter message-enter-bot';
    row.innerHTML = `
        <div class="w-7 h-7 rounded-full bg-gold/30 flex items-center justify-center text-cardinal shrink-0 mt-0.5" aria-hidden="true">
            <i class="${bot.iconClass} text-xs"></i>
        </div>
        <div class="flex flex-col max-w-[85%]">
            <div class="bg-white border border-stone-200 text-stone-800 px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed">
                <div class="prose prose-sm prose-stone max-w-none typing-indicator flex items-center gap-1 py-0.5" aria-label="Thinking">
                    <span class="w-1.5 h-1.5 rounded-full bg-stone-300 animate-bounce" style="animation-delay:0ms"></span>
                    <span class="w-1.5 h-1.5 rounded-full bg-stone-300 animate-bounce" style="animation-delay:120ms"></span>
                    <span class="w-1.5 h-1.5 rounded-full bg-stone-300 animate-bounce" style="animation-delay:240ms"></span>
                </div>
            </div>
            <div class="msg-actions flex items-center gap-2 mt-1 ml-1 h-4"></div>
        </div>`;

    history.appendChild(row);
    requestAnimationFrame(() => row.classList.add('message-enter-active'));
    scrollChatToBottom();

    return {
        row,
        proseEl: row.querySelector('.prose'),
        actionsEl: row.querySelector('.msg-actions'),
    };
}

function updateBotStream(stream, textSoFar) {
    const formatted = sanitizeRenderedHTML(marked.parse(textSoFar || ''));
    stream.proseEl.classList.remove('typing-indicator', 'flex', 'items-center', 'gap-1', 'py-0.5');
    stream.proseEl.innerHTML = formatted + '<span class="stream-cursor" aria-hidden="true"></span>';
    scrollChatToBottom();
}

function finalizeBotStream(stream, finalText, wasStopped) {
    const formatted = sanitizeRenderedHTML(marked.parse(finalText || ''));
    stream.proseEl.classList.remove('typing-indicator', 'flex', 'items-center', 'gap-1', 'py-0.5');
    stream.proseEl.innerHTML = formatted;

    const now = formatTimestamp(new Date());
    stream.actionsEl.innerHTML = `
        <span class="msg-timestamp text-[10px] text-stone-400">${now}${wasStopped ? ' · stopped' : ''}</span>
        <button class="msg-action-btn text-stone-400 hover:text-cardinal w-5 h-5 rounded flex items-center justify-center" title="Copy response" aria-label="Copy response">
            <i class="fa-regular fa-copy text-[11px]" aria-hidden="true"></i>
        </button>
        <button class="msg-action-btn text-stone-400 hover:text-cardinal w-5 h-5 rounded flex items-center justify-center" title="Regenerate response" aria-label="Regenerate response">
            <i class="fa-solid fa-rotate-right text-[11px]" aria-hidden="true"></i>
        </button>`;

    const [copyBtn, regenBtn] = stream.actionsEl.querySelectorAll('button');
    copyBtn.onclick = () => copyMessageText(finalText, copyBtn);
    regenBtn.onclick = () => regenerateLastResponse();

    scrollChatToBottom();
}

function failBotStream(stream, message, offerRetry) {
    stream.row.remove();
    const errorId = appendMessage(message, 'error');

    if (offerRetry && lastUserText) {
        const row = document.getElementById(errorId);
        const pill = row.querySelector('div');
        const retryBtn = document.createElement('button');
        retryBtn.className = 'ml-1 underline decoration-dotted hover:text-red-900';
        retryBtn.textContent = 'Retry';
        retryBtn.onclick = () => { row.remove(); retryLastMessage(); };
        pill.appendChild(retryBtn);
    }
}

function copyMessageText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        const icon = btn.querySelector('i');
        const original = icon.className;
        icon.className = 'fa-solid fa-check text-[11px] text-green-600';
        setTimeout(() => { icon.className = original; }, 1200);
    }).catch(() => { /* clipboard permission denied — silently no-op */ });
}