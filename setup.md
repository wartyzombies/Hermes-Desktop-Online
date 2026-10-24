# Quick setup (Hermes 0.22.2)

This installs the plugin from the current folder, uses the Desktop renderer bundled with the plugin, and enables it. No Hermes Desktop build or source checkout is needed. It works without Git metadata.

## Install

Requirements: Hermes **0.22.2** and Python **3.10+**. The renderer is bundled with the plugin.

From this project folder, run:

```bash
bash scripts/install-local.sh
```

The installer copies this project—including its prebuilt renderer—to `~/.hermes/plugins/desktop-workbench` and enables the plugin. It does not need or alter a Hermes Desktop source checkout. The script may be run again to refresh the installed copy.

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

The prebuilt Desktop renderer is a large bundled asset; Hermes package validation may flag patterns inside its bundled JavaScript.

## Uninstall

```bash
hermes plugins disable desktop-workbench
hermes plugins remove desktop-workbench
```

The Desktop renderer UI can load without a model provider, but sending a prompt requires a configured Hermes provider/model. See [README.md](README.md) for development details, supported capabilities, and known limitations.
