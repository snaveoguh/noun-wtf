---
name: ship-noun-wtf
description: Ship a noun.wtf change to production — commit, push, PR, merge, and the separate manual deploys (Railway API, PartyKit server) that a push does NOT do. Use whenever finishing work on noun.wtf, when the user says "ship it", "deploy", "is it live", or after touching packages/nouns-api, packages/nouns-party, or netlify functions.
---

# Shipping noun.wtf

## The flow

1. **Branch.** Work on the session's assigned branch. Commit messages end with the attribution lines the session gives. No model names in commits or code.
2. **Check:**
   - Typecheck: `npx tsc --noEmit -p .` in the package you touched.
   - Run the relevant vitest files.
   - For anything visual, use the `world-browser-test` skill.
3. **Push:** `git push -u origin <branch>`.
4. **PR and merge:** open a PR to `main` with the GitHub MCP tools, then merge with the `merge` method. The user approves this flow for routine work.
   - **The `Build (22.x)` check fails** in `@nouns/contracts#build` on every PR. It's an upstream contracts job and doesn't affect Netlify. Confirm the PR touches nothing under `packages/nouns-contracts`, then merge anyway. Leave one comment on the PR the first time it shows up.
   - If `main` moved on: `git fetch origin main && git merge origin/main` (never rebase a shared branch).
5. **Netlify:** deploys `main` automatically through GitHub Actions ("Netlify Deploy" workflow, about 5 min). Check it with `actions_list` (`list_workflow_runs`, branch `main`) and look for `conclusion: success`.

## Deploys a push does NOT do

| Changed | Who deploys | Command (the user runs it on their Mac) |
|---|---|---|
| `packages/nouns-webapp/**` incl. `netlify/functions` | automatic | merge to main |
| `packages/nouns-api/**` (Ponder + `/api/chat`) | **manual** | `cd /Users/hugo/noun-wtf && git pull && railway up`, **from the repo root**, never from `packages/nouns-api` (that has no Dockerfile in its upload context) |
| `packages/nouns-party/**` (PartyKit: world room, hoops relay, `noun-warfare` room) | **manual** | `cd /Users/hugo/noun-wtf && git pull && cd packages/nouns-party && npx partykit deploy` |
| Contracts (`packages/nouns-contracts`) | **user only** | Give exact `forge script ... --broadcast` steps. Never handle keys or broadcast for them. |

After merging anything in the manual rows, tell the user the exact command. Until they run it, say which features won't work, e.g. "online hoops/warfare needs the PartyKit deploy; bots work meanwhile".

## Webapp env

`VITE_*` values are baked at build time and hardcoded in `.github/workflows/netlify-deploy.yml`, not set in the Netlify UI. Server-side function secrets (`WORLD_DROPS_SIGNER_KEY`, admin tokens) live in Netlify site env vars, and the user sets those.

## Safety

- Never paste, request or store private keys. Wallet keys go only into the user's own terminal or Netlify env.
- Don't send transactions or deploy contracts for the user, even with a "bot wallet". This container has no keys, and pulling one in from Railway or anywhere else is exactly how keys leak.
- `?offline=1` for every test page. Never join the live room.

## Reporting

Say plainly what's merged, what's live (Netlify run succeeded), and what still needs the user's manual deploy. Link the PR as `owner/repo#N` with the full URL.
