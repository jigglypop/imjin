---
name: ship
description: Deploy to production (imjin1592.com + multiplayer server) by pushing main. Use whenever shipping/deploying/pushing to main.
---

# Shipping to production

**Gate: production only after the owner says to deploy.** New work goes to the dev server first (http://127.0.0.1:5291) and the owner gets the link.

All work happens on `main` in `C:\dev\imjin` (owner 2026-10-20: no worktrees, no branches). Pushing `main` runs typecheck, test and build, then deploys the site (S3 + CloudFront) and the multiplayer server (EC2).

1. `git fetch`, then `git status` and `git log origin/main..main`. Everything committed on local main ships. If origin moved, `git pull --rebase`.
2. Look at every change you are about to commit. Never commit: `_stage/`, `_cand/`, temp `scripts/_*.mjs`, generation sources.
3. Binaries: runtime binaries `npm run assets -- push`, then commit `assets.json` (check `assets -- status --remote`). Generation sources go to the cold archive: `npm run assets -- archive`, never into `assets.json`.
4. Run `npm run typecheck`, `npm test` and `npm run build` on main.
5. Commit (end with the Co-Authored-By line) and `git push origin main`.
6. Watch the GitHub Actions run until it finishes. Then check the live site: `node scripts/shot.mjs --url=https://imjin1592.com/...`, and confirm new files return 200. If the server changed, run `scripts/deploy-mp.sh status`.
7. Report the commit, what shipped, and the live check.

## Rejected
- Worktrees and branches of any kind, including temporary release worktrees (owner 2026-10-20).
- Putting multi-GB generation sources in `assets.json`: CI pulls everything on every deploy.
