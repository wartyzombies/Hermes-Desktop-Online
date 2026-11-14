# Chat export — Hermes Desktop Workbench plugin validation

> **Export note:** Earlier turns in this chat were provided to the assistant as a condensed conversation summary, not as a verbatim transcript. This file preserves the available decisions, work and verification accurately, but it is not a word-for-word export of those earlier turns.

## User — initial objective

Make `hermes plugins validate .` pass in the `Hermes-Desktop-Online` repository for the `desktop-workbench` Hermes plugin. The user clarified that the first repository mentioned was the wrong one and should be ignored. The user asked to fix the repository itself, not loosen the checker, and did not authorize pushing changes.

## Investigation and prior fix

The first validation problem was a vendored Hermes checkout inside the plugin directory. The validator's security scanner walks plugin files and does not respect `.gitignore`, so unrelated vendor files were scanned as plugin code. The vendored checkout was moved beside the repository and excluded from the package. That fix was committed locally as:

- `46c6d3b0` — “Untrack the vendored Hermes checkout so plugin validation passes.”

After that change, a local validator reported all 14 checks passing, but with a security-scan caution due to the renderer bundles.

## User — validation output and environment

The user supplied a new validation failure containing dangerous findings in `dashboard/frame/assets/*.js` and `dashboard/frame/emojibase/en/data.json`, including `curl_pipe_shell`, `echo_pipe_exec`, `inline_shell_exec`, `invisible_unicode`, `read_secrets_file`, `ssh_dir_access`, and `sudo_usage`.

The assistant reproduced findings using the locally available `plugin_guard-v12` but established that this was not the user's checker build. The user confirmed their version was **Hermes Agent v0.22.5 (2026.9.24)**. The user's output included `echo_pipe_exec`, which was absent from the local guard, and did not apply the local guard's generated-asset severity exemptions.

The scanner failure came from `dashboard/frame/`: 1,044 prebuilt Vite renderer files totaling about 45 MB. The local v12 guard downgraded some generated-asset findings, whereas the user's v0.22.5 scanner reported them at full severity.

The assistant asked how to handle the generated payload. The user chose: **untrack `dashboard/frame` and build it at install time**.

## Changes made for the renderer payload

The renderer payload was moved from `dashboard/frame/` to the sibling directory `../hermes-desktop-frame-payload` and is no longer tracked in the repository. It was not deleted. `.gitignore` now explains that `dashboard/frame/` is generated build output and is ignored to keep the security scan from treating minified renderer bundles as plugin code.

`scripts/install-local.sh` was changed to stage the renderer into the installed plugin directory. It looks for a source in this order:

1. `HERMES_DESKTOP_DIST`
2. `$HERMES_SOURCE/apps/desktop/dist`
3. `$HERMES_HOME/hermes-agent/apps/desktop/dist`
4. `$HOME/src/hermes-agent/apps/desktop/dist`
5. A sibling `hermes-desktop-frame-payload` directory

If there is no payload source, the installer exits before copying anything and explains how to supply a Desktop build. The installed plugin still gets the renderer; the repository does not need to track it.

The renderer-specific test now skips when no generated payload has been staged. `README.md`, `setup.md` and `docs/COMPATIBILITY.md` were updated to describe the build-at-install behavior and clarify the packaging implications.

## Verification results

- Local `validate_plugin_dir` run: **14/14 checks passed**, `security scan — safe`, no failures, no warnings.
- `pytest`: **8 passed, 1 skipped** (the skipped check requires a staged renderer payload).
- `bash -n scripts/install-local.sh`: passed.
- Installer happy-path check using a throwaway `HERMES_HOME`: copied the plugin, built a 45 MB renderer payload from the sibling payload, and confirmed the shim was injected into `index.html`.
- Installer no-source check: exited with an actionable message and did not create the plugin install directory.
- Existing live install at `~/.hermes/plugins/desktop-workbench` was left untouched and still contains its renderer.
- The local `hermes` commands on this machine are broken with `ModuleNotFoundError: No module named 'hermes_cli'`, so actual CLI invocation on Hermes 0.22.5 was not available here; validation was performed using the local `validate_plugin_dir` harness.
- No changes were pushed.

## Commit

- `fc87e560` — “Stage the Desktop renderer at install time instead of committing it.”

The working tree was clean after the commit.

## Remaining limitation

A clean clone has no renderer until one is staged. A release artifact should include the generated `dashboard/frame/` output, or installation should use `scripts/install-local.sh` with a Desktop `dist` directory available. This matters because the user's Hermes 0.22.5 scanner does not exempt patterns in `frame/assets` the way the locally available v12 guard did.

The moved payload is currently kept at `../hermes-desktop-frame-payload`; the vendored Hermes checkout is kept at `~/Documents/GitHub/hermes-agent-main-dev`.

## Latest assistant response (summary)

The assistant explained that Hermes 0.22.5's scanner caused the remaining findings, described the untracking and install-time staging change, listed the tests and validator results, and highlighted the clean-clone/release-artifact limitation.

## Latest user request

“This folder has no project instructions (AGENTS.md / CLAUDE.md).

Current user request:
give me this chat exported”
