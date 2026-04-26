# PLAN

## Status
- Approved
- In progress

## Goal
- Reduce GitHub Actions runtime for the hosted `ci` workflow without changing the repo's test or coverage policy.

## In Scope
- Optimize `.github/workflows/ci.yml` so repeated runs spend less time reinstalling development tooling.
- Keep the same hosted checks: install dependencies, run `make ci`, and preserve the existing `ci` status check name used by branch protection.
- Prefer low-maintenance improvements before considering a custom CI container image.

## Out Of Scope
- Building or maintaining a custom CI container image in this pass.
- Changes to application behavior, tests, coverage thresholds, or Render deployment behavior.

## Agreed Constraints
- Keep GitHub as the enforcement point and leave Render auto-deploying from `main`.
- Preserve the PR gate and branch-protection workflow already in place.
- Prefer simple, maintainable optimizations: caching and CI-appropriate install commands.
- Avoid changing the required status check name so existing branch protection remains valid.

## Tooling Decisions
- Use `actions/setup-python` pip caching for `requirements.txt` and `requirements-dev.txt`.
- Use `npm ci` rather than `npm install` in hosted CI for reproducibility and speed.
- Keep local `make install-dev` unchanged for contributor setup; optimize the hosted workflow directly.

## Planned Steps
1. Update the GitHub Actions workflow to enable pip caching.
2. Replace the workflow's broad `make install-dev` step with CI-specific Python and Node install steps.
3. Keep the final hosted execution path on `make ci` so the workflow still exercises the repo's canonical definition-of-done command.
4. Push the workflow update to the existing PR branch and watch the new run.
5. Compare the hosted workflow shape and report the runtime-improvement strategy, plus whether a custom container still looks unnecessary.

## Verification Plan
1. Validate the updated workflow logic against the repo's existing `make ci` contract.
2. Push the workflow change and confirm GitHub Actions reruns successfully.
3. Confirm the `ci` status check name remains stable so branch protection still applies.

## Risks To Watch
- Because `make ci` still expects Node and Python tooling to exist, the workflow must continue creating `.venv` and installing packages correctly.
- Over-optimizing the workflow could accidentally diverge hosted CI from the documented repo commands; keep the workflow close to `make ci` semantics.

## Approval
- Approved by user; execution in progress.
