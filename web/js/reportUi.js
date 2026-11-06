import { projectStats } from "./model.js";
import { buildHtml, buildMarkdown } from "./report.js";
import { openMenu, toast } from "./ui.js";

// Browser-only report actions: build the same documents as report.js, then
// hand them to the download machinery or the family-tree menu.

function fileStem(title) {
  const stem = String(title || "").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "");
  return stem || "language-family";
}

function downloadFile(content, filename, mimeType, message) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(message, { type: "success", duration: 3200 });
}

export function downloadMarkdown(project) {
  const stats = projectStats(project);
  const name = `${fileStem(project.title)}-report.md`;
  downloadFile(
    buildMarkdown(project),
    name,
    "text/markdown",
    `Downloading ${name} — ${stats.languages} language${stats.languages === 1 ? "" : "s"}, ${stats.words} word${stats.words === 1 ? "" : "s"}.`
  );
}

export function downloadHtml(project) {
  const name = `${fileStem(project.title)}-report.html`;
  downloadFile(buildHtml(project), name, "text/html", `Downloading ${name} — a standalone, print-friendly page.`);
}

export function downloadBackup(project) {
  // Local date, not UTC — the name should match what the user sees on the clock.
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const name = `${fileStem(project.title)}-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
  downloadFile(
    JSON.stringify(project, null, 2),
    name,
    "application/json",
    `Downloading ${name} — the full project document.`
  );
}

export function openReportMenu(anchor, project) {
  openMenu(anchor, [
    { label: "Download Markdown report", icon: "book", shortcut: ".md", onClick: () => downloadMarkdown(project) },
    { label: "Download HTML report", icon: "external", shortcut: ".html", onClick: () => downloadHtml(project) },
    { separator: true },
    { label: "Download JSON backup", icon: "save", shortcut: ".json", onClick: () => downloadBackup(project) },
  ]);
}
