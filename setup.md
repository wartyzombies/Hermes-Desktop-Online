# Quick setup (Hermes 0.22.2)

This installs the plugin from the current folder, stages the bundled Desktop renderer into the installed copy, and enables it. It works without Git metadata and does not modify a Hermes checkout.

## Install

Requirements: Hermes **0.22.2** and Python **3.10+**. The renderer payload is staged during install; see below if this checkout has none.

From this project folder, run:

```bash
bash scripts/install-local.sh
```

The installer copies this project to `~/.hermes/plugins/desktop-workbench`, stages the Desktop renderer payload there, and enables the plugin. It does not alter a Hermes Desktop source checkout, and the script may be run again to refresh the installed copy.

The renderer is build output and is not committed, so the installer takes it from the first source it finds: a payload already built in this checkout, `HERMES_DESKTOP_DIST`, `$HERMES_SOURCE/apps/desktop/dist`, `~/.hermes/hermes-agent/apps/desktop/dist`, `~/src/hermes-agent/apps/desktop/dist`, or a payload kept beside this repository. If none exists, the install stops with instructions rather than shipping a plugin whose `/workbench` tab cannot load.

## Open it

Start the Dashboard if it is not already running:

```bash
hermes dashboard --no-open
```

Then, in another terminal:

```bash
hermes desktop-workbench open
```

Open `http://127.0.0.1:9119/workbench` if it does not open automatically. You can check the install with `hermes desktop-workbench status`.

## Test plugin changes

After editing files in this project, rerun:

```bash
bash scripts/install-local.sh
```

That copies the changes, includes the bundled renderer, and enables the plugin. Optional: validate the source package before installing:

```bash
hermes plugins validate .
hermes plugins doctor . --ci
```

The package itself contains no bundled renderer, so validation reads only plugin code. If you build a payload into the checkout to inspect it, Hermes package validation will scan those minified bundles and may flag patterns inside them.

## Uninstall

```bash
hermes plugins disable desktop-workbench
hermes plugins remove desktop-workbench
```

The Desktop renderer UI can load without a model provider, but sending a prompt requires a configured Hermes provider/model. See [README.md](README.md) for development details, supported capabilities, and known limitations.
