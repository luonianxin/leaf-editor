export type PathPickerMode = "files" | "directory";

export interface PathBreadcrumb {
  label: string;
  path: string;
}

export function pathBreadcrumbs(path: string): PathBreadcrumb[] {
  // Canonical Windows paths may use the extended-length prefix.
  const normalized = path.replaceAll("\\", "/").replace(/^\/\/\?\/UNC\//i, "//").replace(/^\/\/\?\//, "").replace(/\/$/, "");
  const uncParts = normalized.startsWith("//") ? normalized.slice(2).split("/").filter(Boolean) : [];
  if (uncParts.length >= 2) {
    const root = `//${uncParts[0]}/${uncParts[1]}`;
    const breadcrumbs: PathBreadcrumb[] = [{ label: `${uncParts[0]}/${uncParts[1]}`, path: root }];
    let current = root;
    for (const part of uncParts.slice(2)) {
      current += `/${part}`;
      breadcrumbs.push({ label: part, path: current });
    }
    return breadcrumbs;
  }

  const drive = normalized.match(/^([A-Za-z]:)(?:\/|$)/);
  if (drive) {
    const root = `${drive[1]}/`;
    const breadcrumbs: PathBreadcrumb[] = [{ label: drive[1], path: root }];
    let current = root.replace(/\/$/, "");
    for (const part of normalized.slice(drive[0].length).split("/").filter(Boolean)) {
      current += `/${part}`;
      breadcrumbs.push({ label: part, path: current });
    }
    return breadcrumbs;
  }

  const absolute = path.startsWith("/");
  const breadcrumbs: PathBreadcrumb[] = absolute ? [{ label: "/", path: "/" }] : [];
  let current = "";
  for (const part of normalized.split("/").filter(Boolean)) {
    current = absolute ? `${current}/${part}` : current ? `${current}/${part}` : part;
    breadcrumbs.push({ label: part, path: current });
  }
  return breadcrumbs;
}

export function togglePickerSelection(selected: readonly string[], path: string, mode: PathPickerMode): string[] {
  if (mode === "directory") return selected[0] === path ? [] : [path];
  return selected.includes(path) ? selected.filter((item) => item !== path) : [...selected, path];
}

export function confirmedPickerPaths(mode: PathPickerMode, currentDirectory: string, selected: readonly string[]): string[] {
  return mode === "directory" ? [selected[0] ?? currentDirectory] : [...selected];
}
