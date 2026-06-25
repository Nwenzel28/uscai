# ✌️ USC Viterbi Discover Engineering — AI Chatbot Project

Welcome to the **USC Viterbi Discover Engineering AI Chatbot**! This web application is a modular, lightweight, single-page conversational interface powered by the Google Gemini API (`gemini-3.1-flash-lite`). It is specifically designed to serve as an interactive engineering advisor bot for high school students.

By splitting the codebase into three distinct layers, the project enforces a clean **Separation of Concerns (SoC)**, allowing team members to update bot personas weekly without risking breakages to the underlying core system logic.

---

## 📂 Project Architecture

The application is split into three main files located in the same directory:

```text
├── index.html     # The User Interface (HTML5 & Tailwind CSS structure)
├── config.js      # The Weekly Persona Configuration (Customizable settings)
└── app.js         # The Application Logic (API integrations & UI manipulation)
1. Presentation Layer (index.html)
Handles the visual structure, layout, and responsive design using Tailwind CSS utility classes. It mirrors USC's official branding with cardinal (#990000) and gold (#FFC72C) accents. It acts as a passive layout shell that imports the behavioral scripts at the bottom of the document.

2. Configuration Layer (config.js)
Contains the BOT_CONFIG global object. This is the only file your team needs to edit weekly. It dictates the bot's display name, FontAwesome icon, and its specific behavioral prompt boundaries.

3. Logic Layer (app.js)
The "engine" of the application. It handles DOMContentLoaded initialization, interacts with browser localStorage to preserve API keys securely, makes POST requests to the Gemini API, and dynamically handles state changes (loading bubbles, user chat bubbles, and structured bot responses).

## 🚀 How to Set Up and Run Locally
Because this project relies entirely on client-side native JavaScript, you do not need to install Node.js, npm, or run complex developer environments.

Step 1: Clone or Save the Files
Ensure that index.html, config.js, and app.js are all saved in the exact same folder.

Step 2: Open the Application
Simply double-click the index.html file to open it directly inside any modern web browser (Chrome, Safari, Edge, or Firefox). Alternatively, if you use VS Code, you can right-click index.html and select Open with Live Server.

Step 3: Insert Your API Credentials
Obtain an API key from the Google AI Studio console.

Paste the key into the Setup Local Credentials section at the top of the interface.

Click Save Key Locally.

## ⚠️ Security Notice: Your API key is safely stored locally inside your browser's private localStorage profile. It never touches a backend server and will never be pushed to public version control platforms like GitHub, eliminating the risk of credential leaking.

## ✍️ Weekly Maintenance Guide
When transitioning to a new engineering discipline each week, your team only needs to modify the parameters in config.js.

Open config.js in a text editor and modify the configuration object:

JavaScript
const BOT_CONFIG = {
    title: "CivicBot (Civil & Env.)",        // Change to your new bot name
    iconClass: "fa-solid fa-helmet-safety",   // Swap FontAwesome icon classes here

    systemPrompt: `You are CivicBot, an enthusiastic expert...` // Update persona/rules here
};
Tips for Effective System Prompts:
Role/Persona: Explicitly state who the AI is mimicking (e.g., "You are AeroBot, a passionate Aerospace Engineer at USC...").

Target Audience: Keep the phrase "Explain concepts clearly and simply to high school students" to keep responses accessible.

Constraints: Enforce physical limits like "Keep every answer to 3 short paragraphs maximum" so the chatbot interface doesn't become overly cluttered.

Signature: Always mandate a strong "Fight On!" ending to honor the Trojan spirit.

## 🛠️ Built With
HTML5 - Page architecture and structural hierarchy.

Tailwind CSS - Utility-first styling framework for rapid UI design.

FontAwesome - Scalable vector icons for clean UI indicators.

Vanilla JavaScript - Lightweight asynchronous programming (Fetch API & DOM API).

Google Gemini API - AI execution engine via the gemini-3.1-flash-lite model.

## ✌️ Fight On!