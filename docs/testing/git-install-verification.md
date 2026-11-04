# Git installation and commit-hook verification

## Changes under test

- Remove the package `prepare` lifecycle script; track generated `lib/` instead.
- Opt-in `.githooks/pre-commit` launches `scripts/precommit.mjs`.
- Reject unstaged/non-ignored untracked inputs outside `lib/` and unresolved merges. Run `pnpm check` and `pnpm verify:runtime`, recheck source and index, and stage only generated `lib/`.
- The initial tests did not change the actual project's commits, index, hooksPath or live profiles. Publication was separately authorized afterward; see the release verification below.

## Environment

Windows / Git Bash; Node.js v24.22.0; pnpm 10.18.1. Package version 0.1.16 (existing user version preserved).

## Executed checks

| Check | Result |
| --- | --- |
| Initial focused hook tests before implementation | Failed: hook/script absent, feature not implemented |
| `pnpm check` | Typecheck and build passed; 45 files / 660 tests passed, including 10 hook tests |
| `pnpm verify:runtime` | Passed manifest, composition row and built-client identity checks |
| `node --check scripts/precommit.mjs` / `sh -n .githooks/pre-commit` | Passed |
| `git diff --check` | Passed |
| `pnpm pack --pack-destination dist` + tar member listing | Package contains host, preset, client, types, maps, manifest, patch, README and LICENSE; no source/test/hook payload |
| Disposable real Git commit with hook enabled via command-local `-c core.hooksPath=.githooks` | Generated output included in the same commit |
| Failure-path hook tests | Partial staging, untracked files, failed checks, missing build output, source changes during checks, unresolved conflicts and index changes are rejected; no automatic source staging |
| Generated output replacement | New output staged and removed output excluded; ignored local files allowed |
| LSP diagnostics | No applicable available server reported; TypeScript was checked by `pnpm typecheck` within `pnpm check` |

## Isolated DSH Git install

A disposable Git repository was created from the current package manifest, `lib/`, patch, README and LICENSE under ignored `tmp/`. This verifies the prebuilt Git package shape, not a published source commit.

With `DSH_HOME` pointing to a new directory under that probe, the installed DSH CLI created a fresh `web`-template Profile and executed:

```text
dsh plugin --profile git-install add git+file:///.../repository#<probe-commit> --config.store-dir=<probe-store>
dsh plugin --profile git-install list
dsh --profile git-install --dump-config
```

Results:

- Official install succeeded with pnpm's default build restrictions; no Nexus lifecycle build ran and no approval configuration was added.
- Plugin list reports `dsh-nexus 0.1.16`.
- Installed host, client and preset entrypoints and patch exist.
- Composed config contains `id: dsh-nexus` / `name: dsh-nexus`.
- pnpm emitted missing-peer warnings for the `@deepseek-ai/*` SDK packages supplied by the host; the install completed. Runtime activation was not checked, so the warnings are not presented as a successful GUI verification.

Local ignored evidence: `tmp/git-install-check.log`, `tmp/git-install-pack.log`, `tmp/git-install-profile.log`, and `tmp/git-install-Z9kRSY/verification.json`. Probe files are disposable, not part of the distributed package.

## Follow-up: full-project real commit

The complete current project was copied into a disposable Git repository under `tmp/full-commit-Bwexmw`. Dependencies were linked individually; its `node_modules/.cache` was kept local. No `lib/` was copied, so the real pre-commit hook had to create all generated files itself.

A real `git -c core.hooksPath=.githooks commit` ultimately passed typechecking, build, all 660 tests and runtime verification. The resulting commit contains the generated host/client/preset output, the hook has mode `100755`, and the snapshot working tree is clean. The actual project's index remains empty and hooksPath remains unset.

Earlier attempts are not counted as passes: linking the whole node_modules directory caused two canonical-path test failures, fixed only in the disposable verification setup. After isolating caches, full-suite attempts also saw an edit-test failure and Windows `EPERM` atomic-rename failures in preset tests. Focused reruns passed, and a full real-commit rerun without project code changes passed. The cause of these intermittent filesystem failures is not established; a failed suite correctly blocks the commit rather than silently proceeding.

Successful full-commit evidence: `tmp/full-commit-Bwexmw/tmp/real-commit-rerun.log`.

## Release verification (packaging changes only)

For publication, a fresh snapshot under `tmp/publish-git-install-aBtZ8N` used committed `bc9df8f` source plus only the Git packaging/hook changes and the existing local version 0.1.16. Uncommitted Shell source/test edits and unrelated local documents were deliberately excluded. The publishable `lib/` was rebuilt from that snapshot, not copied from the modified local Shell source.

The real pre-commit flow passed typechecking, build, all **647 tests** and runtime verification; generated output was included in the snapshot's commit. The difference from 660 tests above is the exclusion of pending user-owned Shell tests. The first full-suite attempt hit another Windows atomic-rename `EPERM`; an unchanged full-commit rerun passed. Evidence: `tmp/publish-git-install-aBtZ8N/tmp/publish-commit.log`.

The actual publication commit includes only the packaging/hook files, documentation and this clean-source build. Existing Shell edits remain uncommitted. Remote installation will be verified separately after the authorized push.

## Remaining manual steps and limitations

- Developer must explicitly enable hooks; hook executable mode must be recorded on first commit for Unix clones (see README).
- Future commits must include intended source changes and their matching generated `lib/`. The publication build deliberately excludes pending Shell edits; a later commit of those edits must regenerate `lib/`.
- Verify the actual public GitHub install only after pushing; old commits/tags still use the old packaging scheme.
- No real GUI, account/network model behavior or plugin runtime activation was tested by this change. No service was started.
- Hook is bypassable and intentionally rejects unrelated unstaged/untracked files too. It does not silently stash user work.
