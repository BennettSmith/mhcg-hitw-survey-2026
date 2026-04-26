# PLAN

## Status
- Pending review

## Goal
- Upgrade the GitHub Actions workflow to current action versions that avoid the Node 20 deprecation path while preserving the existing CI behavior and protected `ci` merge gate.

## In Scope
- Update `.github/workflows/ci.yml` to use newer releases of:
  - `actions/checkout`
  - `actions/setup-python`
  - `actions/setup-node`
- Keep the current parallel job structure and final `ci` gate job.
- Push the workflow update and verify the hosted run still passes.

## Out Of Scope
- Changes to application code, tests, coverage thresholds, or Render deployment behavior.
- Broader CI redesign beyond the action-version upgrade.

## Findings
- Current workflow uses:
  - `actions/checkout@v4`
  - `actions/setup-python@v5`
  - `actions/setup-node@v4`
- Current upstream releases discovered via `gh release view` are:
  - `actions/checkout@v6.0.2`
  - `actions/setup-python@v6.2.0`
  - `actions/setup-node@v6.4.0`

## Agreed Constraints
- Preserve the protected `ci` status check name so `main` branch protection continues to work unchanged.
- Preserve the current GitHub-side PR gate and Render auto-deploy-from-main workflow.
- Keep the change minimal and local to the workflow file unless validation shows a necessary follow-up.

## Planned Steps
1. Update `.github/workflows/ci.yml` to the newer action major versions.
2. Keep all existing install, caching, and parallel-job behavior unchanged otherwise.
3. Push the workflow update to the current branch.
4. Watch the resulting GitHub Actions run and verify that the hosted `ci` check still passes.
5. Confirm whether the Node 20 deprecation annotation is resolved.

## Verification Plan
1. Validate the updated workflow structure locally by inspection.
2. Push the workflow change and confirm GitHub Actions reruns successfully.
3. Confirm the PR still reports a successful `ci` status and note whether the deprecation warnings disappear.

## Risks To Watch
- A newer action major version could change defaults in a way that affects caching or checkout behavior.
- The deprecation warning may persist if GitHub is still surfacing a broader platform notice despite the action upgrade; if so, report the exact residual warning rather than guessing.

## Approval
- Awaiting user review of this workflow-upgrade plan before implementation.
