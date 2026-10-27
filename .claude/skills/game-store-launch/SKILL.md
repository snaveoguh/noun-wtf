---
name: game-store-launch
description: Plan taking browser games to the App Store and Google Play: app lineup (flagship + standalones), a store build that strips crypto / token trading, ad rules players don't hate, pricing (single-game unlock + all-games pass), kids' rules, store assets, the account checklist, and a marketing test that only scales what pays back. Use when the user talks about app stores, monetising games, ads, pricing, or marketing budget.
---

# Games → app stores

Worked out with the noun.wtf owner on 2026-10-26/27. The full plan is the Claude Doc "noun.wtf — App Store release plan".

## Lineup

- **A flagship "Arcade" app** with every game, plus 2–3 standalones for searchable genres (e.g. The Big Drop, Hide & Seek, Pool).
- **All apps join the same multiplayer rooms as the web:** different store apps, one shared world.
- **One codebase:** a `STORE_BUILD` flag plus a Capacitor wrapper per app that opens straight into its game (the deep links already exist).

## Store build

- **Strip:** wallets, on-chain cash-out, token / NFT / auction / DAO screens, and any wording implying in-game coin has real value.
- **Keep:** in-game COIN as points: earned by playing, spent in-game (a pool table costs 5 COIN), never converted to money. That's the owner's choice too: "keep commodities in game, not shitcoins".
- **Enforce it** with a test that scans the store bundle for wallet / on-chain modules.

## Ads (the owner's rules)

- **Rewarded ads are the main earner and opt-in:** "+50 COIN", "another try", "double winnings", a daily spin.
- **Interstitials:**
  - only at natural breaks, never mid-game;
  - at most one every 5 minutes;
  - none in a session's first 5 minutes;
  - skipped right after a rewarded ad.
- **Banners:** menus only.
- **Never pay-to-win.**
- **Kids:** an age gate; non-personalised ads under 13 (COPPA, Apple's rules).

## Pricing (the owner's model)

- **One game ad-free: $5.99.**
- **All-Games Pass: $19.99**, every game including future ones. It's the main offer; after a second unlock, show what's left to pay for the pass.
- **After the 15% small-business cut:** ~$5.09 and ~$17.00.
- **RevenueCat** for shared entitlements across apps and the web, with sign-in. Check App Review 3.1.1 for cross-app unlocks; the fallback is that the pass covers everything inside the Arcade.
- **Restore purchases;** the ad-free tiers still allow opt-in rewarded ads.

## Marketing: test small, scale only what pays back

- **Free first:**
  - smart app banners on the website for phones, plus "get the app" buttons on the game cards;
  - 10–20 s vertical clips from the sizzle reels for TikTok / Reels / Shorts;
  - the existing community.
- **Paid test (~$1,000 of a few-thousand budget, 2 weeks):**
  - Apple Search Ads: genre searches, usually the cheapest good installs;
  - TikTok / Instagram video ads;
  - Google App Campaigns (Play, YouTube, search);
  - small creators at $50–200 a post.
- **The scaling rule:** a channel gets more money only when ~60-day revenue per install beats its cost per install. Casual installs run $0.50–$2.50 and new games often earn less until retention is proven, so the first spend buys data. Then reinvest early earnings into what pays back: snowball it.

## Checklist the owner must do

- Apple Developer ($99/yr), Google Play ($25), the small-business programmes.
- AdMob and RevenueCat accounts.
- Signing keys (kept out of the repo).
- App names, lineup sign-off, a support email, a privacy-policy URL.
- The age-rating and data-safety questionnaires (Claude drafts them).
