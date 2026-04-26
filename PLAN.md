# PLAN

## Status
- Approved
- Completed

## Goal
- Add GitHub-side enforcement so `make ci` runs before changes can merge to `main`.
- Protect `main` so Render only auto-deploys code that has already passed the repo's CI gate.

## In Scope
- Add a GitHub Actions workflow that runs `make install-dev` and `make ci` on pull requests and pushes to `main`.
- Use `gh` to inspect the current repo configuration and, if allowed, configure branch protection for `main`.
- Require the GitHub CI check to pass before merging to `main`.
- Preserve the current Render auto-deploy-from-main workflow.
- Update documentation if the repo's contributor workflow needs to mention GitHub-side CI enforcement.

## Out Of Scope
- Render-side API or dashboard changes unless they become strictly necessary.
- Changes to the application runtime, tests, or coverage policy themselves.

## Agreed Constraints
- Prefer GitHub as the enforcement point and leave Render auto-deploying from `main`.
- Use PR-based merges into `main`; direct pushes should no longer be the normal path.
- The workflow should run both Python and frontend checks through existing `make` targets rather than duplicating logic.
- Branch protection should require the GitHub CI check before merge.
- If GitHub-side automation is blocked by an API limitation or check-name discovery issue, stop at the nearest safe point and report the exact manual follow-up.

## Tooling Decisions
- GitHub Actions will be the hosted CI runner.
- The workflow will use `actions/checkout`, `actions/setup-python`, and `actions/setup-node`.
- The workflow will call `make install-dev` and `make ci`.
- Branch protection should target `main` and require the GitHub Actions CI check.

## Planned Steps
1. Verify `gh` authentication, repo identity, and permission level.
2. Add `.github/workflows/ci.yml` to run `make install-dev` and `make ci` on PRs and pushes to `main`.
3. Run local validation as needed so the workflow content matches the current repo commands.
4. Commit the workflow change on a non-`main` branch if needed for the PR-based flow.
5. Use `gh` / GitHub API to configure branch protection on `main` so the CI check is required before merge.
6. Report any remaining manual GitHub or Render follow-up, especially if the protection rule must wait for the workflow check to exist remotely first.

## Documentation Changes
- Update docs only if the contributor workflow now needs explicit GitHub/PR enforcement notes.

## Verification Plan
1. Confirm the workflow file is syntactically valid and uses the repo's existing commands.
2. Push the workflow so GitHub can register the CI check.
3. Verify the check appears on a PR or push.
4. Apply or validate branch protection so the CI check is required on `main`.
5. Confirm Render can continue auto-deploying from `main` without additional changes.

## Risks To Watch
- GitHub branch protection may need the workflow check to exist remotely before the required-status-check rule can be applied cleanly.
- If direct pushes to `main` are already common, protection may temporarily interrupt that workflow until PR-based merges are adopted.

- Approved by user; execution completed.
