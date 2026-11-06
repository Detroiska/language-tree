// Starts the real app against a throwaway copy of the repository so the UI
// smoke test never writes to the tracked data/project.json.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = process.env.PORT || "8876";

function resolvePython() {
  const candidates = [process.env.PYTHON, "python3", "python"].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error("Python 3.10+ is required for the UI test (set PYTHON to override the interpreter).");
}

const temp = mkdtempSync(join(tmpdir(), "language-tree-ui-"));
cpSync(join(ROOT, "web"), join(temp, "web"), { recursive: true });
cpSync(join(ROOT, "server.py"), join(temp, "server.py"));
mkdirSync(join(temp, "data"), { recursive: true });
writeFileSync(
  join(temp, "data", "project.json"),
  `${JSON.stringify(
    {
      version: 1,
      title: "UI smoke test",
      createdAt: "2026-01-01T00:00:00.000000Z",
      updatedAt: "2026-01-01T00:00:00.000000Z",
      languages: [],
    },
    null,
    2
  )}\n`
);

const child = spawn(resolvePython(), ["-u", join(temp, "server.py"), "--no-browser", "--port", PORT], {
  cwd: temp,
  stdio: "inherit",
  windowsHide: true,
});

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (!child.killed) child.kill();
  try {
    rmSync(temp, { recursive: true, force: true });
  } catch {
    // The server may still hold a file on Windows; the temp directory is safe
    // to leave for the OS to reclaim.
  }
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("exit", cleanup);
child.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
