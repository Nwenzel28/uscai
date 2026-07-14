# Setup Guide

This project is a static, client-side AI chatbot interface that runs entirely in the browser.

## Option 1: Open the app from the repo
1. Clone or download the repository.
2. Open `index.html` in a modern browser (Chrome, Firefox, Edge, or Safari).
3. If the browser blocks scripts from `file://`, use a simple local file server or GitHub Pages instead.

## Option 2: Use GitHub Pages
1. Go to the published GitHub Pages site for this repo:
   `https://nwenzel28.github.io/uscai`
2. The app should load directly in the browser without any local setup.

## Option 3: Download the files directly
1. Download `index.html`, `app.js`, and `config.js` from the repo.
2. Put all three files in the same folder.
3. Open `index.html` in a browser.

## Send your first message
1. Paste your Gemini API key into the credential panel at the top.
2. Click **Save key**.
3. Choose a bot from the advisor dropdown.
4. Type a question in the message box.
5. Press **Enter** or click the send button.

## Notes
- The app stores your Gemini API key locally in browser `localStorage`; it does not send the key to any backend server.
- Bot behavior and available advisors are defined in `config.js`.
- The app uses external CDN assets for Tailwind CSS, FontAwesome, Marked, and KaTeX, so an internet connection is required.

## Customizing bots
- Open `config.js`.
- Add or edit bot objects inside the `BOT_CONFIG` array.
- Each bot should include `title`, `iconClass`, and `systemPrompt`.
- No build step is required after editing; just refresh the page.
