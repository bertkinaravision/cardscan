Clean up this codebase without changing behavior.
Scope: $ARGUMENTS
(If empty, cover the whole app.)

Step 1: Baseline
Run the build, tests, linter, and typecheck. Record the results.
If there are no tests, say so and stop. Propose 3 to 5 minimal
tests covering the main flows and wait for approval, because
cleanup without tests is unverifiable.

Step 2: Audit (report only)
Find and list, with file and line:
- Dead code: unused functions, variables, imports, components,
  routes, files, commented-out blocks
- Unused dependencies in package.json or equivalent
- Duplication: repeated logic that should be one function
- Unclear naming: vague names (data, temp, handleStuff),
  misleading names
- Oversized files or functions doing more than one job
- Hardcoded values that belong in config or constants
- Leftover debug code: console.log, TODOs, test endpoints
- Inconsistent patterns: same task done in different ways

For each: the evidence it is unused or duplicated (search results,
reference counts), and the risk of changing it (low, medium, high).

Step 3: Wait for approval
Present the list ordered by risk, lowest first. Stop and wait.

Step 4: Execute (after approval)
- One category per commit, with a clear message
- Rerun build, tests, linter, and typecheck after each commit
- If anything breaks, revert that commit and report it
- Never mix cleanup with new features or bug fixes. If you find a
  bug, log it in a separate list and leave it alone.

Step 5: Final report
Before and after: lines of code, file count, dependency count,
test results. List anything skipped and why. List bugs found
but not fixed.

Rules:
- Behavior must be identical before and after. No refactors that
  change outputs, routes, data formats, or UI.
- Do not remove anything you cannot prove is unused. Dynamic
  imports, string-based references, and framework conventions
  (file-based routing, serverless function folders) can hide
  usage. Label those "uncertain" and leave them.
- Do not touch environment config, deployment settings, or
  secrets.
- Do not rename public API routes or database or sheet column
  names. Other things depend on them.
- No stylistic rewrites for taste. Only changes that reduce
  confusion, size, or risk.
