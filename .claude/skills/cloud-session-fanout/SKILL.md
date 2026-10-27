---
name: cloud-session-fanout
description: Run big, separable pieces of work as their own Claude Code cloud sessions (each with its own container) instead of in-session agents, then track, verify and integrate them. Use when a request is a new game, a big feature, or several independent features at once; when the user says "spin up another one", "max speed", "do these in parallel"; or when in-session agents are making the machine crawl.
---

# Fan big work out to cloud sessions

In-session agents (`Agent`, worktrees) all share one container. On 2026-10-26, ten of them at once pushed the load to 87: tsc and vitest took 10+ minutes each, tests timed out under load (a timeout that looks like a failure), and a container restart killed every agent. Separate cloud sessions each get their own container: full speed, and a restart in one doesn't touch the others.

## When

- **Own session:** a new game or mode, a big feature, a long render (video reels), a perf / memory investigation, anything that runs a browser for many minutes.
- **Stay local:** small fixes, one-file changes, integration and shipping. Keep in-session `Agent`s to about 3 at once.

## Launch

`create_session` (claude-code-remote MCP):
- `source_url` is the repo and `source_revision` the base (`main`, or a branch that already holds the work it builds on);
- `outcome_branch` is a named branch for it (`claude/<feature>`);
- `title` is short and human: it shows in the user's app;
- leave out `environment_id` (it inherits this one) and `model`.

**The brief is all it has. Make it stand alone:**
1. **Goal**, in the user's own words (quote them), plus the outcome you expect.
2. **Read first:** the CLAUDE.md sections and project skills that matter (browser testing, covers, shipping).
3. **What exists:** files, contracts, how the current thing works, the measured numbers. Paste what you've already learned; don't make it rediscover it.
4. **What to build**, concretely; quote screenshots' details if the user sent any.
5. **Constraints:**
   - the shared files to touch lightly (name them);
   - what else is landing in parallel;
   - "`git fetch origin main` and merge before finishing";
   - perf and budget rules.
6. **Quality bar:** typecheck (with the heap flag if the project needs it), the tests to add, a browser check with screenshots saved to a named folder, the dev-server gotchas (non-HMR, kill by PID only).
7. **Delivery:**
   - "commit and push to `<branch>`; don't merge to main, don't open a PR";
   - the commit attribution lines;
   - "finish with a report: commits, architecture, tests, screenshots, known limits".

Continuing an interrupted local agent's work in a session: commit its WIP in its worktree (leave scratch files out: temp tsconfigs, harness pages, `*_orig` backups), push it to `claude/wip-<feature>`, and start the session on that branch with "you start from an unfinished WIP commit; review it first".

## While they run

- **Don't poll.** `get_session` shows `status_bucket` (working / blocked / completed / failed) and `post_turn_summary`; `list_sessions` (mine: true) lists them all.
- **Check what landed:** `git fetch` + `git log origin/main..origin/claude/<branch>`.
- **A blocked session usually wants a yes / no** (e.g. "push to staging?"). If you're integrating it yourself, tell it so with `send_message`.
- **Tell the user what's running and roughly when,** and never invent results.

## When they finish

- **Verify claims against primary sources.** A session may report "I shipped PR #190 to main". Check `git log origin/main` and the diff against your branch before relying on it.
- **Review risky content** before shipping: e.g. music files. Read the README or provenance. An `imperial-march.mp3` turned out to be the owner's own Suno track, but check.
- **Integrate with `merge-train`.**
- **Sessions the user started themselves** leave branches too. List them, and ask before shipping anything you didn't commission. Old ones especially (3+ days); anything touching an API that deploys separately (Railway etc.).

## Make it stick

When the user sets a working rule ("always open new things at max speed"), write it into the project's skills or CLAUDE.md and commit it, so every future session follows it.
