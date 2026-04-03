# AGENTS.md

## Deployment Rules

`noun.wtf` uses the repo at `snaveoguh/noun-wtf`.

- Production branch: `main`
- Dev branch: `staging`
- Production site: `noun.wtf`
- Dev site: `https://dev-noun-wtf.netlify.app/`

Netlify's current site records are legacy/manual-ish, so GitHub is the source of truth:

1. Push to `staging` to update dev
2. Review on `dev-noun-wtf.netlify.app`
3. Push or merge to `main` to update production

Use the existing Netlify sites, not duplicate sites.

## Safety

- Do not run `npm`, `pnpm`, `npx`, or `netlify` inside random downloaded repos. These tools can execute project scripts and config, which means untrusted repos can run code on the machine.
- In this repo, the fork remote is `nounwtf` and upstream Nouns DAO is `origin`.
- Prefer `main` and `staging` over legacy `master` for deployment work.
