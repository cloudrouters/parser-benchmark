---
description: Check for outdated dependencies and update them one at a time, running tests after each update.
---

# Update Dependencies

1. Inspect the project's package manager, dependency manifests, lockfiles, and existing scripts. Identify the package manager from the project configuration rather than assuming npm.
2. Check which dependencies are outdated and review their current and available versions.
3. Before updating, inspect relevant changelogs, release notes, and breaking changes for the target version when available.
4. Update one dependency at a time, starting with the safest appropriate update. Preserve existing version constraints and project conventions unless a change is necessary.
5. After each individual update, run the relevant test suite. Run type checks, linting, or builds when appropriate.
6. If tests or other checks fail, investigate the cause. Do not proceed to the next dependency until the issue is resolved or the user explicitly approves proceeding with the known failure. Do not weaken or remove tests to make them pass.
7. If an update requires significant code changes, introduces breaking changes, or presents a substantial risk, explain the issue and obtain the user's approval before proceeding.
8. Do not update all dependencies simultaneously, perform unrelated refactoring, or introduce new dependencies without a justified reason.
9. After completing the updates, run the relevant regression tests and quality checks, inspect the final diff, and verify that the lockfile is consistent with the dependency manifests.
10. Report which dependencies were updated, their previous and new versions, the checks performed and their results, and any updates skipped or issues remaining.
11. Do not create commits, push changes, or perform destructive Git operations without the user's explicit approval.