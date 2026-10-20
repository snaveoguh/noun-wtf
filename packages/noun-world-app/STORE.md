# Noun World store kit

This is the copy and the checklist for App Store Connect and the Google Play Console.

> Store rules move. The rules below are as I understand them (Apple App Review Guidelines and Google Play policy, 2025–2026). Re-read the linked sections the week you submit.

## Listing copy

| Field | App Store (limit) | Google Play (limit) |
|---|---|---|
| Name | **Noun World** (30) | **Noun World** (30) |
| Subtitle / short description | **Skate, spray & fly with Nouns** (30) | **Skate, spray, trade and fly a dragon in a weird online world of Nouns.** (80) |
| Category | Games → Action; secondary: Games → Simulation | Game → Action |
| Promotional text (iOS, 170) | New: four weird towns, a dragon you can buy and fly, and NOUN FM pirate radio with live DJ sets. |  |
| Keywords (iOS, 100, comma-separated, no spaces) | `skate,skateboard,open world,multiplayer,graffiti,nouns,pixel,dragon,radio,dj,ice cream,trading,cc0` |  |
| Support URL | https://noun.wtf/world | same (contact email required) |
| Marketing URL | https://noun.wtf | Website: https://noun.wtf |
| Privacy policy URL | **needed** (see Privacy); e.g. https://noun.wtf/world/privacy | same |
| Copyright | © 2026 noun.wtf · Noun art CC0 (Nouns DAO) | |

**Long description (both stores, ≤ 4000):**

Noun World is a free online open world built out of Nouns, the CC0 pixel characters.

- **Skate it.** Bomb the mountain, chase speed records past 1,000 km/h, race the Twins, and find what's behind the door at the Noggle Bowl.
- **Spray it.** Tag any wall with real spray-can graffiti that every rider sees.
- **Hustle it.** Drive the ice cream van between Dry Gulch, Puerto Noun, Noggle City, Neon Nouns, Shroom Hollow and Crater Lil. Buy low, sell high, and grow your business.
- **Fly it.** Save up for a dragon at the Dragon Roost, then take to the sky.
- **Hear it.** NOUN FM plays across the whole map. Book a DJ set and the whole world hears it.
- **Live it.** Other riders are right there with you: text and voice chat, crews, cutscenes, characters with their own voices, and secrets to find.

Every Noun is CC0, and so is the world they ride through. Make one and it's yours.

## Age rating

Several features push the rating up:
- user-generated content (graffiti, chat, DJ sets with YouTube embeds);
- unrestricted **text and voice chat with strangers**;
- cartoon or fantasy violence: none to mild.

Answer the questionnaires honestly:
- **App Store:** "Unrestricted web access" = **No**. The app loads noun.wtf, not arbitrary sites. "User-generated content" = **Yes**. Expect **13+** under Apple's 2025 age tiers.
- **Google Play (IARC):** answer yes to "Users can interact or exchange content" and to "Shares user-provided content". Expect **Teen**.

**Blocker for both stores: chat and UGC moderation.** Apple Guideline 1.2 and Google's UGC policy require, in the app:
1. a way to **report** a player or content (a tag, a chat line, a DJ set);
2. a way to **block or mute** a player;
3. a **filter** for objectionable text (names, chat, DJ set titles);
4. published **contact info** and a way to act on reports promptly (in practice: hide content, ban a rider id).

None of this exists in the game today. A search found no mute, block, report or filter. It needs building before you submit; it's a small feature for the game's backlog.

## Privacy

There is no third-party analytics or ad SDK on the site, and no account system: a rider is a random id kept on the device. Declare the following.

| Data | Where / why | Linked to user? | Tracking? |
|---|---|---|---|
| Rider id (random, localStorage `noun-world-rider-id`) | records, trade books, graffiti authorship | Yes (pseudonymous) | No |
| Display name + character look | shown to other players, on records | Yes | No |
| Gameplay data: speed records with ride traces, trade inventory and coins, missions | Netlify Functions + Blobs (`world-stats`, `world-trade*`, `world-drops`) | Yes | No |
| User content: graffiti tags, DJ sets (YouTube/Audius links, DJ name), text chat lines | `world-graffiti`, `world-fm-library`; chat relays live through PartyKit (not stored) | Yes | No |
| Voice | **peer-to-peer WebRTC audio** when a rider turns the mic on. Not recorded. Other players' devices see each other's IP addresses (WebRTC). | — | No |
| Wallet address (optional) | only if the rider links a wallet (decks, on-chain cash-out) | Yes | No |
| Coarse diagnostics | server logs from Netlify / PartyKit / Railway (IP, user agent) | No | No |

- **App Store privacy labels:**
  - Identifiers → User ID (app functionality).
  - User Content → Gameplay Content, Other User Content, Audio Data (voice, not collected or stored: you may declare it as not collected, since it is P2P and never reaches your servers).
  - Contact Info → none.
  - "Data used to track you" → **none**.
- **Play Data safety:** the same items. Data is encrypted in transit (HTTPS/WSS/DTLS). For deletion: there's no account, so offer a **"delete my data"** path (an email address, or a button that wipes the rider id's rows). Play asks for this.
- **Privacy policy:** write the page from this table and host it at `/world/privacy`, for example.

## Screenshots and media

Use real, HUD-on gameplay. The ads capture pool in the scratchpad has clean 1080² frames to crop from.

| Store | Size (portrait) | Count | Notes |
|---|---|---|---|
| App Store: iPhone 6.9" | **1320 × 2868** (or 1290 × 2796) | 3–10 | required; Apple scales it for smaller iPhones |
| App Store: iPad 13" | **2064 × 2752** (or 2048 × 2732) | 3–10 | required because the app runs on iPad (full screen) |
| App Store: app preview video | 886 × 1920 / 1080 × 1920, 15–30 s, ≤ 500 MB | 0–3 | the 15 s ad cut works |
| Play: phone | 1080 × 1920 (9:16, sides 320–3840 px) | 2–8 (4+ to be featured) | |
| Play: 7" and 10" tablet | 1200 × 1920 / 1600 × 2560 | up to 8 each | needed for tablet visibility |
| Play: feature graphic | **1024 × 500** JPG/PNG | 1 | required; crop the cover's NOUN WORLD lettering |
| Play: icon | **512 × 512**, 32-bit PNG | 1 | `resources/icon.png`, downscaled |
| App Store: icon | 1024 × 1024, no alpha | 1 | `resources/icon.png` (generated into the asset catalog) |

Shot list (one idea per frame, with a big caption on top in the poster style):
1. "SKATE A WORLD OF NOUNS": the plaza crowd.
2. "1000 KM/H MOUNTAIN RUNS": a speed-lines descent.
3. "BUY A DRAGON. FLY IT.": the dragon over Noggle City.
4. "RUN THE ICE CREAM HUSTLE": the van, a customer, the market panel.
5. "SPRAY ANY WALL": a graffiti wall.
6. "NOUN FM: BOOK THE DECKS": the DJ booth in the van.
7. "SIX WEIRD TOWNS": Neon Nouns at night.
8. "THROUGH THE DOOR…": the Upside Down.

## Monetisation: options and the rules that bite

### What's allowed

- **Free, no purchases (recommended for v1).** It's the simplest review and matches the web. Monetise on the web side.
- **Paid app (one-off price).** Allowed. But the web version stays free, so reviewers and users will ask why. It also cuts multiplayer population.
- **In-app purchases for digital goods** (coin packs, the dragon, cosmetics, a "supporter pack"):
  - **Must** use Apple IAP (Guideline **3.1.1**) and Google Play Billing (Payments policy).
  - You can't sell them in the app through Stripe, crypto or a link out.
  - US storefront exception (2025): Apple must allow apps to link to an external web purchase. Check the current status per storefront before relying on it.
  - Coins bought with IAP **must not** be cashable for tokens or money (see below).
- **Ads:**
  - needs a native SDK (AdMob through a Capacitor plugin), because AdSense isn't allowed inside app WebViews;
  - iOS needs the **App Tracking Transparency** prompt for personalised ads, or serve non-personalised ones;
  - rewarded video for coins fits the game best.
  - Ads can't target under-13s, which fits the 13+ rating.

### Crypto, tokens and NFTs: what has to change in the app build

| Feature on the web today | iOS App Store | Google Play |
|---|---|---|
| **Earn coins by playing → claim NTCOIN / goods tokens on Base** (play-to-earn) | **Remove from the iOS app.** 3.1.5(v) bars crypto apps from offering currency for completing tasks, and play-to-earn reward apps get rejected. Turning in-game coins into tokens also turns IAP-bought coins into money. | Allowed **only** with the Financial features / blockchain declaration. You must not "promote or glamorise potential earnings from playing or trading". Safest: also hide in v1. |
| **Deposit tokens back into the game** | Using tokens to unlock in-app goods is unlocking content **without IAP** (3.1.1). **Hide.** | Allowed with the declaration. Purchasing tokenized assets in the app must follow Play's tokenized digital assets rules. |
| **Linking a wallet / Nouns ownership perks** (e.g. deck designs, holder-only items) | 3.1.1: apps may let users **view** NFTs they own, but NFT ownership **must not unlock features or functionality**. Show-only is fine; gating is not. A wallet *app* must come from an organisation account (3.1.5(i)). | Showing owned NFTs is fine. Gating features on them is allowed but must be declared. |
| **Grand Exchange (token trading floor)** | Trading crypto needs a licensed exchange in the region (3.1.5(iii)). **Hide.** | Requires the Financial features declaration and the relevant licences. **Hide.** |

**Practical approach:** ship the app build with the on-chain features off.
- The web build already keeps cash-out behind `VITE_TRADE_ONCHAIN`.
- The app loads the same site, so add a runtime check: hide the "Base ⛓" tab, wallet linking and holder gates when running inside the native shell. Detect it with `window.Capacitor?.isNativePlatform()` or the `?source=app` start URL.
- Keep them on the web.
- This is a small follow-up in the trade and wallet UI. It isn't done in this package.

### Other review risks

- **Apple 4.2 (minimum functionality / "just a website").** The app loads noun.wtf, which reviewers sometimes reject as a wrapped site. In our favour: it's a full 3D game, full screen with no browser chrome, with native audio handling, an offline screen and a home-screen icon. Adding Game Center leaderboards for records, haptics or push for "your DJ set is live" makes the case stronger. If it's rejected, the next step is bundling the built game into `www/`, which needs API URLs made absolute.
- **2.5.2 (downloaded code).** Web content in WKWebView is allowed. Just don't add native code paths that change app behaviour from the server.
- **Sign in with Apple:** not needed. There is no login.
- **Account deletion (5.1.1(v)):** not applicable without accounts. Do provide the "delete my data" path (Privacy).
- **Encryption export:** HTTPS only, so it's exempt. `ITSAppUsesNonExemptEncryption = false` is set by `patch-native.mjs`.
- **Apple Developer account type:** enrol as an **Organisation** (D-U-N-S number) if any wallet or crypto feature might ever ship on iOS. That's also how the seller name reads "noun.wtf" rather than a person.

## Submission checklist

- [ ] Moderation: report, block or mute, word filter, contact address (blocker, see Age rating).
- [ ] Hide on-chain features in the native build (see Crypto, tokens and NFTs).
- [ ] Privacy policy page and a "delete my data" path.
- [ ] Screenshots per the table, plus the Play feature graphic.
- [ ] TestFlight and a Play Internal testing round on real phones (iPhone 12+, a 3–4-year-old Android).
- [ ] App Store Connect: age rating questionnaire, privacy labels, export compliance (auto from plist).
- [ ] Play Console: Data safety, content rating (IARC), target audience 13+, ads declaration, Financial features declaration (say "no" once crypto is hidden).
