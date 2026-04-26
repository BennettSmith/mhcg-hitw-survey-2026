# PLAN

## Status
- Approved
- In progress

## Goal
- Reduce GitHub Actions wall-clock time by running backend and frontend checks in parallel while preserving a single stable merge gate for branch protection.

## In Scope
- Refactor `.github/workflows/ci.yml` into multiple jobs that can execute concurrently.
- Keep branch protection compatible with the existing required `ci` status check.
- Preserve the current test and coverage policy.

## Out Of Scope
- Changes to local `make` targets.
- Changes to Render deployment behavior.
- Changes to application code, test code, or coverage thresholds.

## Agreed Constraints
- Keep GitHub as the enforcement point and leave Render auto-deploying from `main`.
- Preserve a stable gate check for branch protection; do not require manual reconfiguration of the protected branch if avoidable.
- Favor a simple workflow shape: parallel worker jobs plus one lightweight aggregate gate job.

## Tooling Decisions
- Split hosted CI into at least:
  - Python job
  - frontend job
  - final `ci` gate job depending on both
- Keep dependency setup inside each worker job.
- Keep the final branch-protection context as `ci`.

## Planned Steps
1. Refactor the GitHub Actions workflow into parallel worker jobs.
2. Add a final aggregate `ci` job that succeeds only if both worker jobs succeed.
3. Push the workflow update to the existing PR branch.
4. Watch the rerun and confirm that:
   - worker jobs run in parallel
   - the final `ci` check remains the merge gate
   - the PR remains correctly protected

## Verification Plan
1. Validate the workflow structure against the current `main` branch protection rule requiring `ci`.
2. Push the workflow change and confirm the new run shape in GitHub Actions.
3. Confirm the PR still reports a successful `ci` status on completion.

## Risks To Watch
- If the final aggregate job is not named/exposed the same way, branch protection could stop recognizing it.
- Parallel jobs duplicate some setup work, so the win depends on how much of the prior runtime was in serialized test execution versus install overhead.

## Approval
- Approved by user; execution in progress.
