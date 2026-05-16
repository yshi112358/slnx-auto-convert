import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { convertSlnxToSln, NoProjectsInSlnxError } from "./convertSlnx";

const EXT = ".slnx";

function shouldIgnorePath(fsPath: string): boolean {
  const p = fsPath.replace(/\\/g, "/");
  return /\/(Library|Temp|obj|Build|logs|UserSettings)\//i.test(p);
}

function getDebounceMs(): number {
  const n = vscode.workspace
    .getConfiguration("slnxAutoConvert")
    .get<number>("debounceMs");
  return typeof n === "number" && n >= 0 ? n : 800;
}

function autoCreateVstuPatchDisableEnabled(): boolean {
  return (
    vscode.workspace
      .getConfiguration("slnxAutoConvert")
      .get<boolean>("autoCreateVstuPatchDisable") !== false
  );
}

async function updateDefaultSolution(
  folder: vscode.WorkspaceFolder,
  slnxUri: vscode.Uri,
  output: vscode.OutputChannel
): Promise<void> {
  if (!slnxUri.fsPath.toLowerCase().endsWith(EXT)) {
    return;
  }
  const slnAbsPath = slnxUri.fsPath.slice(0, -EXT.length) + ".sln";
  const slnRelative = path
    .relative(folder.uri.fsPath, slnAbsPath)
    .replace(/\\/g, "/");

  await vscode.workspace
    .getConfiguration("dotnet")
    .update(
      "defaultSolution",
      slnRelative,
      vscode.ConfigurationTarget.Workspace
    );

  try {
    await vscode.workspace
      .getConfiguration("omnisharp")
      .update(
        "defaultLaunchSolution",
        slnRelative,
        vscode.ConfigurationTarget.Workspace
      );
  } catch {
    /* OmniSharp 未導入時などキー未定義でも無視 */
  }

  const effective = vscode.workspace
    .getConfiguration("dotnet", folder.uri)
    .get<string>("defaultSolution");
  const noneLabel = vscode.l10n.t("(none)");
  output.appendLine(
    vscode.l10n.t(
      "[slnx-auto-convert] Effective dotnet.defaultSolution: {0} ← expected: {1}",
      effective ?? noneLabel,
      slnRelative
    )
  );
  if (effective !== slnRelative) {
    const hint = vscode.l10n.t(
      "Unity (Visual Studio Editor / vstuc) may overwrite dotnet.defaultSolution in .vscode/settings.json to match .slnx when .vstupatchdisable is missing."
    );
    output.appendLine(
      vscode.l10n.t(
        "[slnx-auto-convert] Effective value differs from expected. User settings may override, or Unity may have patched again. {0}",
        hint
      )
    );
  }
}

async function ensureVstuPatchDisable(
  folder: vscode.WorkspaceFolder,
  output?: vscode.OutputChannel,
  showNotification: boolean = true
): Promise<boolean> {
  const vscodeDir = path.join(folder.uri.fsPath, ".vscode");
  fs.mkdirSync(vscodeDir, { recursive: true });
  const marker = path.join(vscodeDir, ".vstupatchdisable");
  const created = !fs.existsSync(marker);
  if (created) {
    fs.writeFileSync(marker, "");
  }
  const rel =
    path.relative(folder.uri.fsPath, marker) || ".vscode/.vstupatchdisable";
  if (created) {
    output?.appendLine(
      vscode.l10n.t(
        "[slnx-auto-convert] Created {0} to suppress Unity .vscode auto-patch.",
        rel
      )
    );
  } else {
    output?.appendLine(
      vscode.l10n.t("[slnx-auto-convert] {0} already exists.", rel)
    );
  }
  if (showNotification) {
    await vscode.window.showInformationMessage(
      created
        ? vscode.l10n.t(
            "Placed a marker to disable Unity .vscode auto-patch ({0}).",
            rel
          )
        : vscode.l10n.t("{0} already exists.", rel)
    );
  }
  return created;
}

const debounceTimers = new Map<string, NodeJS.Timeout>();

function scheduleProcess(
  slnxUri: vscode.Uri,
  folder: vscode.WorkspaceFolder,
  output: vscode.OutputChannel
): void {
  const key = slnxUri.fsPath;
  const existing = debounceTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const ms = getDebounceMs();
  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key);
      void processSlnxNow(vscode.Uri.file(key), folder, output);
    }, ms)
  );
}

async function processSlnxNow(
  slnxUri: vscode.Uri,
  folder: vscode.WorkspaceFolder,
  output: vscode.OutputChannel
): Promise<void> {
  if (!fs.existsSync(slnxUri.fsPath)) {
    return;
  }
  if (shouldIgnorePath(slnxUri.fsPath)) {
    return;
  }

  const slnPath = slnxUri.fsPath.slice(0, -EXT.length) + ".sln";

  if (autoCreateVstuPatchDisableEnabled()) {
    const marker = path.join(folder.uri.fsPath, ".vscode", ".vstupatchdisable");
    if (!fs.existsSync(marker)) {
      await ensureVstuPatchDisable(folder, output, false);
    }
  }

  output.appendLine(
    vscode.l10n.t(
      "[slnx-auto-convert] Converting: {0}",
      path.relative(folder.uri.fsPath, slnxUri.fsPath) || slnxUri.fsPath
    )
  );
  try {
    const n = convertSlnxToSln(slnxUri.fsPath, slnPath);
    fs.unlinkSync(slnxUri.fsPath);
    await updateDefaultSolution(folder, slnxUri, output);
    output.appendLine(
      vscode.l10n.t(
        "[slnx-auto-convert] Done ({0} projects). Removed .slnx and updated dotnet.defaultSolution.",
        String(n)
      )
    );
  } catch (e) {
    const msg =
      e instanceof NoProjectsInSlnxError
        ? vscode.l10n.t(
            "No projects found in {0}",
            path.relative(folder.uri.fsPath, e.slnxAbsolutePath) ||
              e.slnxAbsolutePath
          )
        : e instanceof Error
          ? e.message
          : String(e);
    output.appendLine(vscode.l10n.t("[slnx-auto-convert] Error: {0}", msg));
    void vscode.window.showErrorMessage(
      vscode.l10n.t("SLNX conversion failed: {0}", msg)
    );
  }
}

async function convertAllInWorkspace(
  output: vscode.OutputChannel
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return;
  }
  for (const folder of folders) {
    const pattern = new vscode.RelativePattern(folder, "**/*.slnx");
    const files = await vscode.workspace.findFiles(
      pattern,
      "**/{Library,Temp,obj,Build,Logs,logs,UserSettings}/**"
    );
    for (const uri of files) {
      if (shouldIgnorePath(uri.fsPath)) {
        continue;
      }
      await processSlnxNow(uri, folder, output);
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(
    vscode.l10n.t("SLNX Auto Convert")
  );
  context.subscriptions.push(output);

  const watchEnabled = () =>
    vscode.workspace
      .getConfiguration("slnxAutoConvert")
      .get<boolean>("watchEnabled") !== false;

  const activeWatchers: vscode.Disposable[] = [];

  function disposeWatchers(): void {
    for (const w of activeWatchers) {
      w.dispose();
    }
    activeWatchers.length = 0;
  }

  function attachWatchers(): void {
    disposeWatchers();
    if (!watchEnabled()) {
      return;
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const w = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, "**/*.slnx")
      );
      const onEvt = (uri: vscode.Uri) => {
        const wf = vscode.workspace.getWorkspaceFolder(uri);
        if (!wf || wf.uri.fsPath !== folder.uri.fsPath) {
          return;
        }
        if (shouldIgnorePath(uri.fsPath)) {
          return;
        }
        scheduleProcess(uri, wf, output);
      };
      w.onDidCreate(onEvt);
      w.onDidChange(onEvt);
      activeWatchers.push(w);
    }
  }

  attachWatchers();
  context.subscriptions.push(new vscode.Disposable(() => disposeWatchers()));

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("slnxAutoConvert")) {
        attachWatchers();
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      attachWatchers();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "slnx-auto-convert.convertWorkspace",
      async () => {
        await convertAllInWorkspace(output);
        output.show(true);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "slnx-auto-convert.disableUnityVsCodePatch",
      async () => {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
          await vscode.window.showWarningMessage(
            vscode.l10n.t("No workspace folders are open.")
          );
          return;
        }
        let created = 0;
        for (const f of folders) {
          const wasNew = await ensureVstuPatchDisable(f, output, false);
          if (wasNew) {
            created++;
          }
        }
        await vscode.window.showInformationMessage(
          created > 0
            ? vscode.l10n.t(
                "Created .vscode/.vstupatchdisable in {0} place(s). Unity settings auto-patch stops.",
                String(created)
              )
            : vscode.l10n.t("All folders already have .vstupatchdisable.")
        );
        output.show(true);
      }
    )
  );
}

export function deactivate(): void {
  for (const t of debounceTimers.values()) {
    clearTimeout(t);
  }
  debounceTimers.clear();
}
