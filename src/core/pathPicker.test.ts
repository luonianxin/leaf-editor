import { describe, expect, it } from "vitest";
import { confirmedPickerPaths, pathBreadcrumbs, togglePickerSelection } from "./pathPicker";

describe("path picker helpers", () => {
  it("builds navigable breadcrumbs for Windows, UNC, and POSIX paths", () => {
    expect(pathBreadcrumbs("C:\\Users\\Ada\\Documents")).toEqual([
      { label: "C:", path: "C:/" },
      { label: "Users", path: "C:/Users" },
      { label: "Ada", path: "C:/Users/Ada" },
      { label: "Documents", path: "C:/Users/Ada/Documents" },
    ]);
    expect(pathBreadcrumbs("\\\\server\\share\\folder")).toEqual([
      { label: "server/share", path: "//server/share" },
      { label: "folder", path: "//server/share/folder" },
    ]);
    expect(pathBreadcrumbs("/home/ada")).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "ada", path: "/home/ada" },
    ]);
    expect(pathBreadcrumbs("\\\\?\\C:\\Users")).toEqual(pathBreadcrumbs("C:\\Users"));
    expect(pathBreadcrumbs("\\\\?\\UNC\\server\\share\\folder")).toEqual(pathBreadcrumbs("\\\\server\\share\\folder"));
    expect(pathBreadcrumbs("/")).toEqual([{ label: "/", path: "/" }]);
    expect(pathBreadcrumbs("C:\\")).toEqual([{ label: "C:", path: "C:/" }]);
  });

  it("toggles multiple files but keeps at most one selected directory", () => {
    expect(togglePickerSelection([], "/a.txt", "files")).toEqual(["/a.txt"]);
    expect(togglePickerSelection(["/a.txt"], "/b.txt", "files")).toEqual(["/a.txt", "/b.txt"]);
    expect(togglePickerSelection(["/a.txt", "/b.txt"], "/a.txt", "files")).toEqual(["/b.txt"]);
    expect(togglePickerSelection(["/one"], "/two", "directory")).toEqual(["/two"]);
    expect(togglePickerSelection(["/two"], "/two", "directory")).toEqual([]);
  });

  it("chooses the current directory when no child directory is selected", () => {
    expect(confirmedPickerPaths("directory", "/current", [])).toEqual(["/current"]);
    expect(confirmedPickerPaths("directory", "/current", ["/current/child"])).toEqual(["/current/child"]);
    expect(confirmedPickerPaths("files", "/current", ["/current/a.txt", "/current/b.txt"])).toEqual([
      "/current/a.txt",
      "/current/b.txt",
    ]);
  });
});
