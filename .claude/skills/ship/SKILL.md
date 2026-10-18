---
name: ship
description: Deploy to production (imjin1592.com + multiplayer server) safely from a messy main checkout. Use whenever shipping/deploying/pushing to main.
---

# Shipping to production

**Gate: production only after the owner has looked at it on the local dev server and said to deploy.** Everything new goes to the dev server first (http://127.0.0.1:5291, or the chapters dev server) and the owner gets the link. Never announce or start a production deploy on your own.

Pushing `main` runs typecheck, test and build, then deploys the site (S3 + CloudFront) and the multiplayer server (EC2). The main checkout usually holds other sessions' uncommitted work, so never commit from it directly.

1. `git fetch`. Run `git log origin/main..main`: if local `main` is ahead, those commits would ship too. Base on **origin/main**, never on local main.
2. Create one temporary worktree `.claude/worktrees/ship-<topic>` on a branch of the same name. Junction `node_modules` to the main checkout's, and unlink the junction before deleting the worktree.
3. Copy in only the files of the feature being shipped. Diff each against origin/main. Never ship:
   - other sessions' work
   - `_stage/` or `_cand/`
   - temp `scripts/_*.mjs`
   - generation sources
4. Run `npm run typecheck`, `npm test` and `npm run build` in the worktree.
5. Binaries:
   - Runtime binaries: `npm run assets -- push`, then commit `assets.json`. Check with `assets -- status --remote`.
   - Generation sources (concepts, raw/rig GLBs, candidates) go to the cold archive instead: `npm run assets -- archive`. They never go in `assets.json`.
6. Make one commit, ending with the Co-Authored-By line, and fast-forward push it to origin main.
7. Watch the GitHub Actions run until it finishes. Then check the live site: open the affected page and take a screenshot (`node scripts/shot.mjs --url=https://imjin1592.com/...`), and confirm new files return 200. If the server changed, run `scripts/deploy-mp.sh status`.
8. Remove the worktree and the branch. Report the commit, what shipped, what was left out and why, and the live check.

## Rejected
- Pushing from local main, which shipped unreviewed local commits on 2026-10-17.
- Putting multi-GB generation sources in `assets.json`: CI pulls everything on every deploy.
- Parallel worktrees with full asset copies: they filled the C: drive.
