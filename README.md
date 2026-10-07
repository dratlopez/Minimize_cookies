<div align="center">
  <img src="./Minimize_cookies.png" width="360" alt="Minimize Cookies">
</div>

<p align="center">
  <b>English</b> · <a href="./README.es.md">Español</a>
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-3.7-2FA968?style=flat-square">
  <img alt="license" src="https://img.shields.io/badge/license-CC%20BY--NC%204.0-E5484D?style=flat-square">
  <img alt="tampermonkey" src="https://img.shields.io/badge/works%20with-Tampermonkey-16212C?style=flat-square">
  <img alt="languages" src="https://img.shields.io/badge/languages-ES%20%C2%B7%20EN%20%C2%B7%20FR%20%C2%B7%20DE%20%C2%B7%20IT%20%C2%B7%20PT%20%C2%B7%20NL-0F1720?style=flat-square">
</p>

<p align="center">
  A Tampermonkey userscript that finds cookie-consent banners on (almost)
  any site and rejects everything for you — no reading fine print, no
  hunting for the hidden "reject" link.
</p>

<p align="center">
  <a href="https://dratlopez.github.io/Minimize_cookies/">🌐 Project site</a> ·
  <a href="./Minimize_cookies-3.7.js">⬇️ Install script</a> ·
  <a href="#-how-it-works">🧠 How it works</a>
</p>

---

> [!TIP]
> A small face icon appears at the top-right corner as soon as a cookie
> banner is detected. Its color tells you how sure the script is, and
> its expression tells you what it's doing. Tap it once — if the
> rejection actually went through, it turns into a green checkmark. It
> never fakes success.

## ✨ Key Features

- 🧠 **Native API first**: calls `OneTrust.RejectAll()`, `Cookiebot.submitCustomConsent()`, `Didomi.setUserDisagreeToAll()`, `UC_UI.denyAllConsents()` / `__ucCmp.denyAllConsents()` (Usercentrics) or `__cmp('setConsent', 0, …)` (consentmanager.net) directly when available — the most reliable rejection path there is.
- 🕸️ **Shadow DOM aware**: many modern consent banners hide their markup inside nested Shadow DOM. This script looks there too.
- 🌍 **Multi-language text matching**: recognizes "reject all" phrasing (and single words like "Decline") across Spanish, English, French, German, Italian, Portuguese and Dutch, with partial coverage for Polish, Swedish, Norwegian and Finnish.
- 🪜 **Cascading fallback**: if there's no direct "reject all" button, it opens the preferences panel, switches every toggle off, and hits Save/Confirm — always in that priority order.
- 🎯 **Confidence-aware**: every detection is rated high, medium or low (see below), so the icon only acts on its own when it's reasonably sure — it never guesses on a weak match.
- 🔁 **Auto-continuation**: on sites that open a second panel after the first click (or load it slowly), the script keeps going on its own — see [The icon's expressions](#-the-icons-expressions) below.
- ✅ **Honest success indicator**: the icon only turns green when a real rejection action was executed — not when the banner was simply hidden.
- 🔒 **Zero permissions**: `@grant none`. It only touches the DOM of the page you're already on.

## 🎨 The Icon's Expressions

The icon is a small face whose **color** reflects how confident the detection is, and whose **expression** reflects what's currently happening:

| Color | Confidence | Meaning | Tappable? |
|---|---|---|---|
| 🔴 Red | High | Native CMP API or a known, trusted selector matched | Yes |
| 🟠 Orange | Medium | A generic banner was verified (literal "cookie" text + overlay + a real action button) | Yes |
| ⚪ Gray | Low | Something *might* be a cookie banner, but the signal is too weak to trust | No — inert on purpose, to avoid false positives |

| Expression | When it shows | What it means |
|---|---|---|
| 🙂 Normal (wry mouth) | A banner was just detected | Tap it to reject |
| 😠 Angry (straight mouth, furrowed brow) | Right after a tap that didn't finish the job | The first attempt didn't find a complete rejection path (e.g. the "reject all" button hasn't appeared yet, or a preferences panel just opened) |
| 😣 Retry (frown + furrowed brow) | Automatically, following the angry face | The script detected a *new* banner/panel within a few seconds of your tap and is **auto-continuing** without you needing to tap again |
| ✅ Green check | A rejection action actually ran | Success — the icon fades out shortly after |

**Why a second (or third) step sometimes happens:** some sites don't expose a single "reject all" button — tapping once opens a *preferences panel* instead, and only there does the real reject/save action live. Rather than making you tap twice, the script remembers that you just interacted with a cookie banner and treats anything new that appears within the next ~20 seconds as part of the same flow, continuing automatically (retry face) until it either succeeds (green check) or runs out of recognizable options. On a handful of slow-loading sites this sequence can take several seconds — that's expected, not a hang.

## 🧠 How It Works

The script never clicks blindly. It walks this priority list and stops at the first step that applies:

| Step | Action | Why it comes first |
|---|---|---|
| **0** | Call the CMP's own native API (OneTrust, Cookiebot, Didomi, Usercentrics, consentmanager.net) | The platform itself exposes a function for exactly this. |
| **1** | Match a known selector/ID for a reject button | Nearly as reliable, for when the API isn't exposed. |
| **2** | Text-match a "reject all" button, in 8+ languages | Covers CMPs with no public API or identifiable classes. |
| **3** | Open the preferences panel ("Customize", "Privacy settings"...) | Many sites hide the real reject option one level deeper. |
| **4** | Switch every toggle off, then click Save/Confirm | Last resort, when no "reject all" exists at any level. |

## 🍪 Recognized Platforms

`OneTrust` · `Cookiebot` · `Didomi` · `Usercentrics` · `consentmanager.net` · `Quantcast Choice` · `Sourcepoint` · `TrustArc` · custom hand-built banners · Shadow DOM–based widgets

## ⚙️ Installation

1. Install a userscript manager — [Tampermonkey](https://www.tampermonkey.net/) on desktop (Chrome, Firefox, Edge, Safari). On mobile, only **Firefox for Android**, **Kiwi Browser** or **Yandex Browser** support extensions — Chrome/Safari mobile do not.
2. Open Tampermonkey → *Create a new script*, delete the placeholder, and paste the contents of [`Minimize_cookies-3.7.js`](./Minimize_cookies-3.7.js). Save with `Ctrl/Cmd + S`.
3. Browse normally. The face icon appears top-right whenever a cookie banner is detected.
4. Tap it. If the rejection succeeded, it turns into a green checkmark for a couple of seconds and disappears. If it needs another step, it'll show the retry face and keep going on its own (see [The icon's expressions](#-the-icons-expressions)).

## ⚠️ Honest Limitations

- There's no universal 100% solution — some fully custom banners may not be recognized yet.
- On **cookie-wall sites** — those that only let you either subscribe/pay or accept cookies, with no genuine "reject" option anywhere — the script can't invent a rejection path the site itself doesn't offer.
- The green indicator confirms a real rejection action ran; it can't verify server-side what the site actually does with that preference.
- Found a site where it fails? Open an [issue](https://github.com/dratlopez) with a screenshot of the banner — the more variants get documented, the more reliable this gets.

## 📄 License

Copyright © 2026 **DrATLopez Antonio Tur López**.
Released under **[Creative Commons Attribution-NonCommercial 4.0 (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/)**.

Official repository: [github.com/dratlopez](https://github.com/dratlopez)
