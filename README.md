# SLNX auto-convert【Cursor Extension】

First release of a **VS Code / Cursor** extension that converts `**.slnx`** (as produced by Unity / Visual Studio) into a classic `**.sln**`. Conversion runs **inside the extension (TypeScript)** — **no Python** is required on the machine.

## Download

Use the `**slnx-auto-convert-0.1.0.vsix`** asset attached to the release:

- [Release v0.1.0](https://github.com/yshi112358/slnx-auto-convert/releases/tag/v0.1.0)

## Install

1. Open the Command Palette in VS Code or Cursor.
2. Run **“Extensions: Install from VSIX…”**.
3. Select the downloaded `.vsix` file.

To build from source, see [Building from source](#building-from-source).

## What it does

- Watches for **create/change** events on `**.slnx`** in the workspace and generates a `**.sln**` with the same base name.
- After a successful conversion, **deletes the source `.slnx`** (expect your toolchain to regenerate it when needed).
- Updates `**dotnet.defaultSolution**` to the **workspace-relative path** of the generated `**.sln`** (via `**ConfigurationTarget.Workspace**` — folder-level scope is not supported for this setting).
- To reduce Unity **Visual Studio Editor** overwriting `**dotnet.defaultSolution`** back to `**.slnx**`, the extension can **auto-create** `**.vscode/.vstupatchdisable`** before conversion if it is missing (on by default; disable with `**slnxAutoConvert.autoCreateVstuPatchDisable**`).

## Requirements

- **VS Code** `^1.85.0` or compatible (per `engines.vscode`).
- **Activation:** workspace must contain at least one `***.csproj`** (typical Unity C# layout).

## Commands


| Command                                                        |
| -------------------------------------------------------------- |
| **SLNX: Convert all .slnx in workspace**                       |
| **SLNX: Disable Unity .vscode auto-patch (.vstupatchdisable)** |


## Settings (excerpt)


| Key                                          | Description                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `slnxAutoConvert.watchEnabled`               | Enable or disable automatic conversion via file watching (default: on).         |
| `slnxAutoConvert.debounceMs`                 | Debounce delay in milliseconds for `.slnx` create/change events.                |
| `slnxAutoConvert.autoCreateVstuPatchDisable` | If missing, create `.vscode/.vstupatchdisable` before conversion (default: on). |


## Notes / known behavior

- **Multi-root workspaces:** relative paths for `**dotnet.defaultSolution`** may need care depending on layout.
- The C# language server may log transient **CodeLens resolve** version mismatches right after a solution switch; **Developer: Reload Window** often clears them.

## Building from source

```bash
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository
```

## License

MIT — see [LICENSE](./LICENSE).