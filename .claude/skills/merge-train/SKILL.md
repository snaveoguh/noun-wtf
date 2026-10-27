---
name: merge-train
description: Take a pile of finished feature branches (from cloud sessions, agents or the user's own sessions) to one verified, shipped batch: inventory what isn't on main, merge one at a time, resolve the "two features added the same kind of thing" conflicts, verify, ship, confirm the deploy. Use when the user asks "what's ready to go to main", "ship everything", or several sessions have reported done.
---

# Merge train: many branches → one shipped batch

## 1. Inventory

```bash
git fetch -q origin
git rev-list --count origin/main..origin/<your-branch>
for r in $(git branch -r --format='%(refname:short)' | grep 'origin/claude/'); do
  n=$(git rev-list --count origin/main..$r); d=$(git diff --name-only origin/main...$r | wc -l)
  [ "$n" -gt 0 ] && [ "$d" -gt 0 ] && echo "$r: $n commits, $d files | $(git log -1 --format='%cr | %s' $r)"
done
```

- Use three-dot diffs (`main...branch`): commits whose content is already on main (merged another way) show 0 files.
- Cross-check with `list_sessions`: each session's `status_bucket` and `post_turn_summary` say whether its work is finished. Only take completed ones.
- **Sort into three groups:**
  - (a) yours / commissioned and finished: take;
  - (b) the user's own recent finished sessions: take, and say so;
  - (c) old (3+ days), unreviewed copy, or API / backend code that deploys separately: ask first.

## 2. Merge, one at a time

```bash
git merge --no-edit --no-verify -q origin/main
for b in A B C; do
  git merge --no-edit --no-verify -q origin/claude/$b 2>&1 | grep -E "CONFLICT|fatal"
  [ -n "$(git diff --name-only --diff-filter=U)" ] && { echo "STOP at $b"; break; }
done
```

Stop at the first conflict, resolve it, commit, then continue the loop from the next branch.

## 3. Conflicts: almost always "keep both"

Parallel features collide where each adds one of something: a game id in a union type, a `GAMES` / tile entry, a homepage callback, a `readonly x = new X(this)` field, a `dispose()` line, a UI component line, an import, a pose-blob key, a CLAUDE.md section.

- **Simple hunks:** concatenate the two sides with a regex over the markers:
  ```python
  CONF = re.compile(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> [^\n]+\n", re.S)
  s = CONF.sub(lambda m: m.group(1) + m.group(2), s)
  assert '<<<<<<<' not in s
  ```
- **Punctuation:** a union's last member carries the `;`. `| 'parkour';` + `| 'pool';` becomes `| 'parkour'\n  | 'pool';`.
- **A shared tail after the hunk:** two `useCallback`s / `useEffect`s whose bodies continue identically past `>>>>>>>`. Concatenating would glue two heads onto one body. Rebuild each in full: head A + tail, head B + tail.
- **Dropped imports:** one side deleted an import the other side's hunk re-adds (e.g. `SprayPanel`). Keep it only if it's still used (grep).
- **Comments edited on both sides:** write one comment that says both things.
- **Real semantic clashes:** decide on purpose. E.g. `cars.driving` vs the new `cars.inCar` (passengers count): take the broader one and keep the other side's added lines.
- **Markdown sections** need a blank line between them after the merge.

## 4. Verify the merged result (not each branch)

- **Typecheck the whole package.** Big projects need more heap: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` (the 2 GB default OOMs).
- **Run every affected test dir together.** Failures that only appear merged are the point: e.g. a test's fake game object missing a field another branch now reads (`cars: { inCar: false }`).
- **Browser smoke test:** homepage tiles, the app boots on desktop and phone with every new system present (`!!g.parkour`, `!!g.pool`…), each new deep link launches. A test that only times out on an overloaded machine isn't a failure: rerun it with longer timeouts before concluding anything.

## 5. Ship

- PR to main with a body listing each merged branch and what it does, plus the checks run. Merge with the `merge` method.
- If GitHub says "merge conflicts" though local merged cleanly, merge `origin/main` into the branch, push, and retry.
- Confirm the deploy run (e.g. Netlify Deploy workflow on main) finishes `success` before saying "live".
- Tell the user any manual deploys still needed (Railway `railway up`, `wrangler deploy` for a websocket worker), and what was deliberately left out and why.
