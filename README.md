<div align="center">
  <img src="./banner.svg" width="720" alt="Minimize Cookies">
</div>

<p align="center">
    <strong>English</strong>
    <a href="README.es.md">Español</a>
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-1.8-2FA968?style=flat-square">
  <img alt="license" src="https://img.shields.io/badge/license-CC%20BY--NC%204.0-E5484D?style=flat-square">
  <img alt="tampermonkey" src="https://img.shields.io/badge/works%20with-Tampermonkey-16212C?style=flat-square">
</p>

<p align="center">
  A Tampermonkey userscript that finds cookie-consent banners on (almost)
  any site and rejects everything for you — no reading fine print, no
  hunting for the hidden "reject" link.
</p>

<p align="center">
  <a href="https://dratlopez.github.io/Minimize_cookies/">🌐 Project site</a> ·
  <a href="./Minimize_cookies-1.8.js">⬇️ Install script</a> ·
  <a href="#-how-it-works">🧠 How it works</a>
</p>

---

> [!TIP]
> A small red diamond appears at the top-right corner as soon as a cookie
> banner is detected. Click it once — if the rejection actually went
> through, it turns into a green checkmark. It never fakes success.

## ✨ Key Features

- 🧠 **Native API first**: calls `OneTrust.RejectAll()`, `Cookiebot.submitCustomConsent()`, `Didomi.setUserDisagreeToAll()` or `UC_UI.denyAllConsents()` directly when available — the most reliable rejection path there is.
- 🕸️ **Shadow DOM aware**: many modern consent banners hide their markup inside nested Shadow DOM. This script looks there too.
- 🌍 **Multi-language text matching**: recognizes "reject all" phrasing (and single words like "Decline") across Spanish, English, French, German, Italian, Portuguese and Dutch.
- 🪜 **Cascading fallback**: if there's no direct "reject all" button, it opens the preferences panel, switches every toggle off, and hits Save/Confirm — always in that priority order.
- ✅ **Honest success indicator**: the diamond only turns green when a real rejection action was executed — not when the banner was simply hidden.
- 🔒 **Zero permissions**: `@grant none`. It only touches the DOM of the page you're already on.

## 🧠 How It Works

The script never clicks blindly. It walks this priority list and stops at the first step that applies:

| Step | Action | Why it comes first |
|---|---|---|
| **0** | Call the CMP's own native API (OneTrust, Cookiebot, Didomi, Usercentrics) | The platform itself exposes a function for exactly this. |
| **1** | Match a known selector/ID for a reject button | Nearly as reliable, for when the API isn't exposed. |
| **2** | Text-match a "reject all" button, in 8+ languages | Covers CMPs with no public API or identifiable classes. |
| **3** | Open the preferences panel ("Customize", "Privacy settings"...) | Many sites hide the real reject option one level deeper. |
| **4** | Switch every toggle off, then click Save/Confirm | Last resort, when no "reject all" exists at any level. |

## 🍪 Recognized Platforms

`OneTrust` · `Cookiebot` · `Didomi` · `Usercentrics` · `Quantcast Choice` · `Sourcepoint` · `TrustArc` · custom hand-built banners · Shadow DOM–based widgets

## ⚙️ Installation

1. Install a userscript manager — [Tampermonkey](https://www.tampermonkey.net/) on desktop (Chrome, Firefox, Edge, Safari). On mobile, only **Firefox for Android**, **Kiwi Browser** or **Yandex Browser** support extensions — Chrome/Safari mobile do not.
2. Open Tampermonkey → *Create a new script*, delete the placeholder, and paste the contents of [`Minimize_cookies-1.8.js`](./Minimize_cookies-1.8.js). Save with `Ctrl/Cmd + S`.
3. Browse normally. The red diamond appears top-right whenever a cookie banner is detected.
4. Click it. If the rejection succeeded, it turns into a green checkmark for a couple of seconds and disappears.

## ⚠️ Honest Limitations

- There's no universal 100% solution — some fully custom banners may not be recognized yet.
- The green indicator confirms a real rejection action ran; it can't verify server-side what the site actually does with that preference.
- Found a site where it fails? Open an [issue](https://github.com/dratlopez) with a screenshot of the banner — the more variants get documented, the more reliable this gets.

## 📄 License

Copyright © 2026 **DrATLopez Antonio Tur López**.
Released under **[Creative Commons Attribution-NonCommercial 4.0 (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/)**.

Official repository: [github.com/dratlopez](https://github.com/dratlopez)
