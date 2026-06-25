// ==========================
// app.js
// CORE CHATBOT LOGIC
// ==========================

// Track the currently active bot (defaults to index 0: CivicBot)
let currentBotIndex = 0;

// Apply config to UI once the HTML has loaded
document.addEventListener('DOMContentLoaded', () => {
    updateBotUI(); // Initialize the first bot
    
    // Auto-detect if a key is already saved and adjust UI
    if (localStorage.getItem('gemini_api_key')) {
        document.getElementById('apiSetupPanel').classList.add('hidden');
        document.getElementById('updateKeyBtn').classList.remove('hidden');
    }
});

// Function to handle switching bots via the dropdown
function switchBot() {
    const selector = document.getElementById('botSelector');
    currentBotIndex = parseInt(selector.value);
    updateBotUI();
    
    // Have the new bot introduce itself in the chat
    appendMessage(`Fight On! I am ${BOT_CONFIG[currentBotIndex].title}. How can I help you today?`, 'bot');
}

// Function to update the title and icon on the screen
function updateBotUI() {
    const activeBot = BOT_CONFIG[currentBotIndex];
    document.getElementById('botTitle').innerText = activeBot.title;
    document.getElementById('botIcon').className = activeBot.iconClass + ' text-lg';
}

// Save API key to browser memory
function saveKey() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (key) {
        localStorage.setItem('gemini_api_key', key);
        alert('Key saved. You are ready to go.');
        document.getElementById('apiKeyInput').value = '';
        
        // Hide the big top panel, show the small bottom button
        document.getElementById('apiSetupPanel').classList.add('hidden');
        document.getElementById('updateKeyBtn').classList.remove('hidden');
    } else {
        alert('Please paste a valid API key first.');
    }
}

// Show the API key setup panel again if the user wants to update it
function showApiKeyPanel() {
    document.getElementById('apiSetupPanel').classList.remove('hidden');
    document.getElementById('updateKeyBtn').classList.add('hidden');
    
    // Auto-focus the input box for convenience
    document.getElementById('apiKeyInput').focus();
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
        div.innerHTML = `
            <div class="bg-[#990000] text-white p-3.5 rounded-2xl rounded-tr-none text-sm shadow-sm">
                ${text}
            </div>`;
    } else if (sender === 'bot') {
        div.className = 'flex gap-3 max-w-[85%]';
        
        // --- NEW MARKDOWN + MATH LOGIC ---
        // Tell marked.js to use the KaTeX extension for math
        marked.use(window.markedKatex({ throwOnError: false }));
        
        // Convert the raw Gemini markdown & LaTeX into HTML
        const formattedHTML = marked.parse(text);
        
        div.innerHTML = `
            <div class="w-8 h-8 rounded-full bg-[#990000]/10 flex items-center justify-center text-[#990000] shrink-0">
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
        div.innerHTML = `
            <div class="bg-red-50 text-red-700 border border-red-200 p-3 rounded-xl text-xs flex items-center gap-2 max-w-[90%]">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>${text}</span>
            </div>`;
    }

    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return id;
}