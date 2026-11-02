# Noun World growth plan

Noun World is a zero-install browser game: **one link drops you into a city.**
No app store, no download, no account. That is the pitch, and the loop is:

> a moment from the game gets shared → the share unfurls as a playable card →
> one tap and the viewer is in the city, *as the rider who shared it* → they
> make their own moment and share it.

Everything below exists to feed that loop.

## What's built

| Piece | Where | What it does |
| --- | --- | --- |
| Play-as links | `noun.wtf/world?seed=<key>[&name=<name>]` | Starts the game as that rider. Missingnoun riders work too (`-m` keys). |
| Play-as cards | `/og/world/<key>.png` (1200×630), `/og/world/fc/<key>.png` (1200×800) | The link unfurls on X, Discord, iMessage, Slack, Telegram and Farcaster as the rider on a board with **PLAY AS ME**. |
| In-game SHARE | the share icon in the HUD's icon row | **PLAY-AS LINK** opens a cast in Farcaster, the share sheet on phones, or copies it on desktop. **SNAPSHOT** grabs the frame with the link printed along the bottom: the share sheet on phones, a download on desktop. |
| Farcaster mini app | `/.well-known/farcaster.json`, `fc:miniapp` tags on /world | Noun World opens inside Warpcast / Farcaster clients; every play-as link in a cast shows a **PLAY AS ME** button that launches it in place. |
| Clips | `packages/nouns-webapp/public/clips/` | Short vertical (1080×1920) and horizontal (1920×1080) cuts, each under 4 MB, made by the sizzle pipeline from real gameplay. |

### Before it works on Farcaster

The manifest ships with an empty `accountAssociation`. The owner signs it once
with their Farcaster account (FID); see "Farcaster mini app" in
`packages/nouns-webapp/README.md`. Until then embeds still render on most
clients, but the app can't be listed or added.

## The clips and their hooks

Post the vertical cut on TikTok / Reels / Shorts / Farcaster, the horizontal
one on X and YouTube. Always put the link in the first line (or the first
reply on X) and **always a play-as link**, not the bare homepage: it unfurls
as a card with a button.

| Clip | Files | Hooks (pick one, keep it under 10 words) |
| --- | --- | --- |
| CAMP fly-in + reading | `camp-flyin-{v,h}` | "you wake up in a condemned penthouse" · "this is the loading screen" · "the game opens on a book" |
| The window jump | `camp-jump-{v,h}` | "the only way out is the window" · "146 metres. no fall damage" · "POV: you skip the fire escape" |
| Missingnoun skating | `missingnoun-skate-{v,h}` | "the glitch can skate" · "my character is a missing texture" · "play as this. it's a link" |

Caption template:

```
<hook>
play as me 👉 noun.wtf/world?seed=<key>
no download. it's a link.
```

Use the seed of the rider in the clip so the card matches the video (the
missingnoun clip's rider is `…-m`).

## Where to post

| Place | Format | Why |
| --- | --- | --- |
| Farcaster (/nouns, /gaming, /skateboarding channels) | vertical clip + a play-as link as the second embed | The link becomes a mini app button: one tap plays, no leaving the feed. This is the best channel for the loop. |
| X | horizontal clip, link in the first reply | The card shows the rider + PLAY AS ME; quote-post other people's snapshots. |
| TikTok / Reels / Shorts | vertical clip, link in bio pointing at `noun.wtf/world` | Reach. "Link in bio" is fine because it's still zero install. |
| Discord (Nouns, skate / indie game servers) | snapshot or play-as link | The card unfurls with the rider; good for "play as me" challenges. |
| iMessage / group chats | play-as link | iMessage shows the card big; the game runs in Safari. |

## Cadence

- **Daily:** one post at **Noun O'Clock** (the daily auction end). New Noun →
  post "today's Noun just dropped, play as it" with a play-as link for the
  freshly minted Noun's seed. The card draws itself from the seed, no
  design work.
- **3× a week:** one clip (rotate the three above, then new ones as they're
  cut). Same clip, different hook, is fine: test hooks, not footage.
- **Weekly:** repost the best player snapshots (ask for them: "post your
  snapshot, best one gets reposted"). Every snapshot already carries the
  link.
- **Monthly:** a new clip from whatever shipped (cars, pool, hide & seek,
  parkour routes): add shots to `scripts/sizzle/shots.mjs`, cut vertical +
  horizontal, add a row to the table above.

## Noun O'Clock as the daily event

Noun O'Clock is when the auction ends and a Noun is born. Make it the game's
daily moment too:

1. When the auction settles, post the new Noun's play-as link
   (`noun.wtf/world?seed=<bg-body-acc-head-glasses>`); the card is drawn
   from the seed.
2. Until it settles, the **crystal ball** (`/crystal-ball`) shows the
   **missed-blocks reel**: every block since the auction ended as the Noun it
   *would* have minted. Each card has **DREAM** (save it to your dream
   drafts) and **PLAY** (opens `/world?seed=…`, the same play-as link). So
   during Noun O'Clock: screenshot or clip the reel, post "these Nouns were
   never born. play as one", and link the crystal ball. Every PLAY is a
   new rider in the city, and once they're in, SHARE gives them their own
   play-as link to post.
3. Players who skate as the day's Noun are the day's crowd. Repost their
   snapshots under the day's thread.

## Measuring it

Keep it simple: count play-as link opens (`/world?seed=` hits in Netlify
analytics, the og-rider-image function's invocations show how often cards
were rendered, i.e. how often links were unfurled) and new riders a day.
Double down on the channel and hook whose links get opened, drop the rest.
