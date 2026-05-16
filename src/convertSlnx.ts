import * as fs from "fs";
import * as path from "path";
import { v5 as uuidv5 } from "uuid";

/** Thrown when `.slnx` contains no project entries (localized in the extension host). */
export class NoProjectsInSlnxError extends Error {
  constructor(public readonly slnxAbsolutePath: string) {
    super("NoProjectsInSlnxError");
    this.name = "NoProjectsInSlnxError";
  }
}

/** SDK スタイルの C# プロジェクト（Unity の .csproj と整合）— Python 版と同一 */
const CSHARP_PROJECT_TYPE_GUID =
  "{9A19103F-16F7-4668-BE54-9A1E7A4F7556}";

/** Python ElementTree の子 `Project`（XML 名前空間付きタグ含む）を近似 */
function collectProjects(slnxContent: string): string[] {
  const projects: string[] = [];
  const seen = new Set<string>();
  const re = /<(?:\{[^}]+\})?Project\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slnxContent)) !== null) {
    const tag = m[0];
    const pm =
      /\bPath\s*=\s*"([^"]+)"/i.exec(tag) ??
      /\bpath\s*=\s*"([^"]+)"/i.exec(tag) ??
      /\bPath\s*=\s*'([^']+)'/i.exec(tag) ??
      /\bpath\s*=\s*'([^']+)'/i.exec(tag);
    if (!pm) {
      continue;
    }
    const p = pm[1]!.trim();
    if (p && !seen.has(p)) {
      seen.add(p);
      projects.push(p);
    }
  }
  return projects;
}

function projectGuidForPath(relativeCsproj: string): string {
  const normalized = relativeCsproj.replace(/\\/g, "/");
  return uuidv5(`slnx-to-sln:${normalized}`, uuidv5.URL).toUpperCase();
}

function buildSlnLines(projectPaths: string[]): string[] {
  const lines: string[] = [
    "Microsoft Visual Studio Solution File, Format Version 12.00",
    "# Visual Studio Version 17",
    "VisualStudioVersion = 17.0.31903.286",
    "MinimumVisualStudioVersion = 10.0.40219.1",
  ];
  const guids: string[] = [];
  for (const rel of projectPaths) {
    const guid = projectGuidForPath(rel);
    guids.push(guid);
    const displayName = path.parse(rel).name;
    lines.push(
      `Project("${CSHARP_PROJECT_TYPE_GUID}") = "${displayName}", "${rel}", "{${guid}}"`
    );
    lines.push("EndProject");
  }
  lines.push("Global");
  lines.push("\tGlobalSection(SolutionConfigurationPlatforms) = preSolution");
  lines.push("\t\tDebug|Any CPU = Debug|Any CPU");
  lines.push("\t\tRelease|Any CPU = Release|Any CPU");
  lines.push("\tEndGlobalSection");
  lines.push("\tGlobalSection(ProjectConfigurationPlatforms) = postSolution");
  for (const guid of guids) {
    lines.push(`\t\t{${guid}}.Debug|Any CPU.ActiveCfg = Debug|Any CPU`);
    lines.push(`\t\t{${guid}}.Debug|Any CPU.Build.0 = Debug|Any CPU`);
    lines.push(`\t\t{${guid}}.Release|Any CPU.ActiveCfg = Release|Any CPU`);
    lines.push(`\t\t{${guid}}.Release|Any CPU.Build.0 = Release|Any CPU`);
  }
  lines.push("\tEndGlobalSection");
  lines.push("\tGlobalSection(SolutionProperties) = preSolution");
  lines.push("\t\tHideSolutionNode = FALSE");
  lines.push("\tEndGlobalSection");
  lines.push("EndGlobal");
  lines.push("");
  return lines;
}

/**
 * .slnx を .sln に変換（tools/slnx_to_sln.py と同じ出力規則）。
 * @returns 含めたプロジェクト数
 */
export function convertSlnxToSln(
  slnxAbsolutePath: string,
  slnAbsolutePath: string
): number {
  const content = fs.readFileSync(slnxAbsolutePath, "utf8");
  const projects = collectProjects(content);
  if (projects.length === 0) {
    throw new NoProjectsInSlnxError(slnxAbsolutePath);
  }
  const body = buildSlnLines(projects).join("\r\n");
  fs.writeFileSync(slnAbsolutePath, body, "utf8");
  return projects.length;
}
