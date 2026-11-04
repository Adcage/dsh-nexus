# Git installation and local build hook implementation plan

**Goal:** Install Nexus from its Git repository without install-time builds; build and stage `lib/` before local commits.

**Approved design:** Track `lib/`, remove `prepare`, and provide an opt-in repository-local pre-commit hook. No bot, release attachment, automatic commit/push, dependency addition, or automatic Git configuration change. Preserve existing user changes and version 0.1.16.

**Architecture:** `.githooks/pre-commit` launches a Node script. Reject unstaged tracked files, non-ignored untracked files outside generated `lib/`, and unresolved merges before running `pnpm check` and `pnpm verify:runtime`. Check inputs and the index again after validation, then stage only `lib/`. Never stash or stage source files automatically. Developers explicitly enable the hook using `git config --local core.hooksPath .githooks`; plugin consumers do not enable hooks.

**Tech stack:** Existing Node.js, pnpm, Git, Vitest; POSIX hook wrapper (also supported by Git for Windows).

## Tasks

1. Add behavioral tests using disposable Git repositories and real pnpm scripts. Cover a successful commit, unstaged/partial changes, untracked inputs, failed checks, changed inputs during checks, missing build outputs, and absence of install lifecycle scripts. Run tests first and confirm failure.
2. Implement the hook and executable wrapper. Reject unsafe states without altering the source index. Run the focused tests.
3. Remove `prepare`; stop ignoring `lib/`; normalize hook line endings; update installation, upgrade and developer documentation. Include hook tests in the existing offline suite.
4. Run `pnpm check` and `pnpm verify:runtime`, inspect generated files and the final diff. Exercise Git dependency installation in isolation if the local environment permits it; distinguish local-package evidence from remote installation.

## Acceptance and limitations

- Repository includes built host, preset and client entrypoints; no installation lifecycle build scripts.
- Hook builds before staging generated output and blocks mismatched source/index states.
- No writes to the actual profile, real Git config or actual index during this task.
- Git hooks are opt-in, bypassable and require Node/pnpm in PATH. New source changes must be committed with corresponding build output. Remote installation is not available until these changes are committed and pushed by the user.
