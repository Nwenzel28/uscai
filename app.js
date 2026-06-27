// ==========================
// app.js
// CORE CHATBOT LOGIC
// ==========================

// Track the currently active bot (defaults to index 0)
let currentBotIndex = 0;

// Max height (px) the composer textarea is allowed to grow to before it scrolls.
// Matches the max-h-[140px] set on #userInput in index.html.
const COMPOSER_MAX_HEIGHT = 140;

// Apply config to UI once the HTML has loaded
document.addEventListener('DOMContentLoaded', () => {
    populateDropdown(); // <-- Generate the dropdown options first
    updateBotUI(); // Initialize the first bot

    // Auto-detect if a key is already saved and adjust UI
    if (localStorage.getItem('gemini_api_key')) {
        document.getElementById('apiSetupPanel').classList.add('hidden');
        document.getElementById('updateKeyBtn').classList.remove('hidden');
        document.getElementById('clearKeyBtn').classList.remove('hidden');
    }
});

// Dynamically build the dropdown from config.js
function populateDropdown() {
    const selector = document.getElementById('botSelector');
    selector.innerHTML = ''; // Clear anything currently in the select

    BOT_CONFIG.forEach((bot, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = bot.title;
        selector.appendChild(option);
    });
}

// Function to handle switching bots via the dropdown
function switchBot() {
    const selector = document.getElementById('botSelector');
    currentBotIndex = parseInt(selector.value);
    updateBotUI();

    // Have the new bot introduce itself in the chat
    appendMessage(`Fight On! I am ${BOT_CONFIG[currentBotIndex].title}. How can I help you today?`, 'bot');
}

// Update the advisor icon (now shown inside the composer, not a separate header)
// and the message placeholder so it's still clear who you're talking to.
function updateBotUI() {
    const activeBot = BOT_CONFIG[currentBotIndex];
    document.getElementById('botSelectorIcon').className = activeBot.iconClass + ' absolute left-2.5 top-1/2 -translate-y-1/2 text-cardinal text-xs pointer-events-none';

    const inputField = document.getElementById('userInput');
    inputField.placeholder = `Ask ${activeBot.title} a question...`;
}

// Save API key to browser memory
function saveKey() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (key) {
        localStorage.setItem('gemini_api_key', key);
        alert('Key saved. You are ready to go.');
        document.getElementById('apiKeyInput').value = '';

        // Hide the big top panel, show the small key-management buttons
        document.getElementById('apiSetupPanel').classList.add('hidden');
        document.getElementById('updateKeyBtn').classList.remove('hidden');
        document.getElementById('clearKeyBtn').classList.remove('hidden');
    } else {
        alert('Please paste a valid API key first.');
    }
}

// Show the API key setup panel again if the user wants to update it
function showApiKeyPanel() {
    document.getElementById('apiSetupPanel').classList.remove('hidden');
    document.getElementById('updateKeyBtn').classList.add('hidden');
    document.getElementById('clearKeyBtn').classList.add('hidden');

    // Auto-focus the input box for convenience
    document.getElementById('apiKeyInput').focus();
}

// Remove the saved key entirely (important on shared/lab computers so the
// next student doesn't inherit your key) and return to the setup state.
function clearKey() {
    const confirmed = confirm('Remove the saved API key from this browser? You will need to paste it again to keep chatting.');
    if (!confirmed) return;

    localStorage.removeItem('gemini_api_key');

    document.getElementById('updateKeyBtn').classList.add('hidden');
    document.getElementById('clearKeyBtn').classList.add('hidden');
    document.getElementById('apiSetupPanel').classList.remove('hidden');
    document.getElementById('apiKeyInput').focus();
}

// Grow the composer textarea as the user types, up to COMPOSER_MAX_HEIGHT,
// then let it scroll internally instead of growing further.
function autoResizeInput() {
    const textarea = document.getElementById('userInput');
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, COMPOSER_MAX_HEIGHT) + 'px';
}

// Enter sends the message; Shift+Enter inserts a newline like most chat apps.
function handleComposerKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

// Send a message to the AI
async function sendMessage() {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        alert('Please paste your Gemini API key into the credentials panel first.');
        return;
    }

    const inputField = document.getElementById('userInput');
    const userText = inputField.value.trim();
    if (!userText) return;

    appendMessage(userText, 'user');
    inputField.value = '';
    autoResizeInput(); // collapse the textarea back down after sending

    const loadingId = appendMessage('Thinking...', 'loading');

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [
                        { role: 'user', parts: [{ text: userText }] }
                    ],
                    systemInstruction: {
                        parts: [{ text: BOT_CONFIG[currentBotIndex].systemPrompt }]
                    },
                    generationConfig: {
                        maxOutputTokens: 500,
                        temperature: 0.7
                    }
                })
            }
        );

        const data = await response.json();
        document.getElementById(loadingId).remove();

        if (response.ok) {
            const replyText = data.candidates[0].content.parts[0].text;
            appendMessage(replyText, 'bot');
        } else {
            const errMsg = data.error ? data.error.message : 'Unknown error.';
            appendMessage('Error: ' + errMsg, 'error');
        }

    } catch (err) {
        if (document.getElementById(loadingId)) {
            document.getElementById(loadingId).remove();
        }
        appendMessage('Connection error: ' + err.message, 'error');
    }
}

// Render a message bubble
function appendMessage(text, sender) {
    const chatHistory = document.getElementById('chatHistory');
    const id = 'bubble-' + Date.now();
    const div = document.createElement('div');
    div.id = id;

    // Grab the active bot configuration for the correct icon
    const activeBot = BOT_CONFIG[currentBotIndex];

    if (sender === 'user') {
        div.className = 'flex justify-end gap-3 max-w-[85%] ml-auto';
        const bubble = document.createElement('div');
        bubble.className = 'bg-cardinal text-white p-3.5 rounded-2xl rounded-tr-none text-sm shadow-sm whitespace-pre-wrap';
        bubble.textContent = text; // textContent, not innerHTML: never let raw user input become markup
        div.appendChild(bubble);
    } else if (sender === 'bot') {
        div.className = 'flex gap-3 max-w-[85%]';

        // Tell marked.js to use the KaTeX extension for math
        marked.use(window.markedKatex({ throwOnError: false }));

        // Convert the raw Gemini markdown & LaTeX into HTML
        const formattedHTML = marked.parse(text);

        div.innerHTML = `
            <div class="w-8 h-8 rounded-full bg-cardinal/10 flex items-center justify-center text-cardinal shrink-0">
                <i class="${activeBot.iconClass} text-sm"></i>
            </div>
            <div class="bg-stone-100 text-stone-800 p-3.5 rounded-2xl rounded-tl-none text-sm shadow-sm prose prose-sm prose-stone max-w-none">
                ${formattedHTML}
            </div>`;
    } else if (sender === 'loading') {
        div.className = 'flex gap-3 max-w-[85%] animate-pulse';
        div.innerHTML = `
            <div class="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center text-stone-400 shrink-0">
                <i class="fa-solid fa-spinner animate-spin text-sm"></i>
            </div>
            <div class="bg-stone-100 text-stone-500 p-3 rounded-2xl rounded-tl-none text-sm italic">
                ${text}
            </div>`;
    } else if (sender === 'error') {
        div.className = 'flex justify-center w-full';
        const bubble = document.createElement('div');
        bubble.className = 'bg-red-50 text-red-700 border border-red-200 p-3 rounded-xl text-xs flex items-center gap-2 max-w-[90%]';
        bubble.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><span></span>';
        bubble.querySelector('span').textContent = text; // textContent: error text may echo API input
        div.appendChild(bubble);
    }

    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return id;
}