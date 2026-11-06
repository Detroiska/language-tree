// Server tests for Language Tree — plain Node, no framework and no DOM.
//
//   node tests/server.test.mjs
//
// The suite copies server.py into a temp directory with its own data/ and a
// minimal web/ root, then talks to it over HTTP on an ephemeral port. It pins
// the API contract that the UI and older clients rely on: JSON error envelopes
// for every method, distinct empty/oversized body statuses, gzip handling,
// revision conflicts, the loopback Host check, and the framing/content headers.

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

let passed = 0;
const failures = [];

function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    return;
  }
  failures.push(`${name}\n    expected: ${e}\n    actual:   ${a}`);
}

function truthy(name, condition) {
  if (condition) passed += 1;
  else failures.push(`${name}\n    expected a truthy result`);
}

const SERVER_PY = fileURLToPath(new URL("../server.py", import.meta.url));
const MAX_BODY_BYTES = 12 * 1024 * 1024;

const project = {
  version: 1,
  title: "Server test project",
  createdAt: "2026-01-01T00:00:00.000000Z",
  updatedAt: "2026-01-01T00:00:00.000000Z",
  languages: [{ id: "lang_test", name: "Test", parentId: null, vocabulary: [], soundChanges: [], allophony: [] }],
};

function resolvePython() {
  const candidates = [process.env.PYTHON, "python3", "python"].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error("Python 3.10+ is required for the server suite (set PYTHON to override the interpreter).");
}

async function startServer(python) {
  const root = mkdtempSync(join(tmpdir(), "language-tree-server-"));
  copyFileSync(SERVER_PY, join(root, "server.py"));
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "web"), { recursive: true });
  writeFileSync(join(root, "data", "project.json"), `${JSON.stringify(project, null, 2)}\n`);
  writeFileSync(join(root, "web", "index.html"), "<!doctype html><title>Language Tree test</title>\n");

  const child = spawn(python, ["-u", join(root, "server.py"), "--no-browser", "--port", "0"], {
    cwd: root,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const url = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => finish(new Error(`Server did not start in time.\n${stdout}\n${stderr}`)), 15000);
    const finish = (error) => {
      clearTimeout(timer);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
    };
    const onStdout = (chunk) => {
      stdout += chunk;
      const match = stdout.match(/http:\/\/[^\s]+/);
      if (match) {
        finish();
        resolve(match[0].replace(/\/$/, ""));
      }
    };
    const onStderr = (chunk) => {
      stderr += chunk;
    };
    const onError = (error) => finish(error);
    const onExit = (code) => finish(new Error(`Server exited with ${code} before listening.\n${stdout}\n${stderr}`));
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", onError);
    child.on("exit", onExit);
  });

  return { root, child, url };
}

async function stopServer(server) {
  if (server.child.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        server.child.kill("SIGKILL");
        resolve();
      }, 5000);
      server.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      server.child.kill();
    });
  }
  rmSync(server.root, { recursive: true, force: true });
}

async function call(server, path, options = {}) {
  const response = await fetch(`${server.url}${path}`, { redirect: "manual", ...options });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Static files and malformed responses keep json null.
  }
  return { status: response.status, headers: response.headers, text, json };
}

function rawCall(server, { method = "GET", path = "/", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${server.url}${path}`);
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        method,
        path,
        headers,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // A non-JSON body means the JSON contract broke; callers assert on it.
          }
          resolve({ status: response.statusCode, headers: response.headers, text, json });
        });
      }
    );
    request.on("error", reject);
    request.end();
  });
}

const python = resolvePython();
const server = await startServer(python);

try {
  /* ---- static app and headers -------------------------------------------- */

  const root = await call(server, "/");
  equal("GET / serves the static app", root.status, 200);
  equal("GET / sends X-Frame-Options", root.headers.get("x-frame-options"), "DENY");
  equal("GET / sends nosniff", root.headers.get("x-content-type-options"), "nosniff");
  equal("GET / sends no-referrer", root.headers.get("referrer-policy"), "no-referrer");
  equal("GET / disables caching", root.headers.get("cache-control"), "no-store, max-age=0");
  equal(
    "GET / sends a script-src self CSP",
    root.headers.get("content-security-policy")?.includes("script-src 'self'"),
    true
  );
  equal(
    "GET / CSP denies framing",
    root.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"),
    true
  );

  const health = await call(server, "/api/health");
  equal("GET /api/health returns 200", health.status, 200);
  equal("GET /api/health is JSON", health.headers.get("content-type"), "application/json; charset=utf-8");
  equal("GET /api/health sends X-Frame-Options", health.headers.get("x-frame-options"), "DENY");
  equal(
    "GET /api/health sends the CSP",
    health.headers.get("content-security-policy")?.includes("script-src 'self'"),
    true
  );
  equal("health reports ok", health.json?.ok, true);

  const current = await call(server, "/api/project");
  equal("GET /api/project returns 200", current.status, 200);
  equal("GET /api/project returns the document", current.json?.title, project.title);

  /* ---- request body validation (#12) ------------------------------------- */

  const empty = await call(server, "/api/project", { method: "PUT" });
  equal("empty PUT is 400, not 413", empty.status, 400);
  equal("empty PUT returns a JSON error", empty.json?.error, "Request body is required.");

  const tooLarge = await rawCall(server, {
    method: "PUT",
    path: "/api/project",
    headers: { "Content-Length": String(MAX_BODY_BYTES + 1), "Content-Type": "application/json" },
  });
  equal("oversized PUT is 413", tooLarge.status, 413);
  equal("oversized PUT returns a JSON error", tooLarge.json?.error, "Request body is too large.");

  const invalidJson = await call(server, "/api/project", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  equal("malformed JSON is 400", invalidJson.status, 400);
  truthy("malformed JSON names the parse failure", /Invalid JSON/.test(invalidJson.json?.error || ""));

  const invalidProject = await call(server, "/api/project", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ languages: [] }),
  });
  equal("project validation is 400", invalidProject.status, 400);
  truthy("validation names the missing title", /title/.test(invalidProject.json?.error || ""));

  const badEncoding = await call(server, "/api/project", {
    method: "PUT",
    headers: { "Content-Encoding": "br", "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  equal("unsupported Content-Encoding is 415", badEncoding.status, 415);

  /* ---- gzip -------------------------------------------------------------- */

  const gzipSave = await call(server, "/api/project", {
    method: "PUT",
    headers: { "Content-Encoding": "gzip", "Content-Type": "application/json" },
    body: gzipSync(Buffer.from(JSON.stringify(project))),
  });
  equal("gzip PUT saves the project", gzipSave.status, 200);
  const afterGzip = await call(server, "/api/project");
  equal("gzip PUT persists the project", afterGzip.json?.title, project.title);

  const truncatedGzip = gzipSync(Buffer.from(JSON.stringify(project))).subarray(0, 12);
  const badGzip = await call(server, "/api/project", {
    method: "PUT",
    headers: { "Content-Encoding": "gzip", "Content-Type": "application/json" },
    body: truncatedGzip,
  });
  equal("truncated gzip is 400", badGzip.status, 400);
  truthy("truncated gzip returns a JSON error", typeof badGzip.json?.error === "string" && badGzip.json.error.length > 0);

  /* ---- revision conflicts ------------------------------------------------ */

  const beforeConflict = await call(server, "/api/project");
  const conflict = await call(server, "/api/project", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Base-Revision": "stale-revision" },
    body: JSON.stringify(project),
  });
  equal("stale revision is 409", conflict.status, 409);
  equal("conflict reports the current revision", conflict.json?.currentRevision, beforeConflict.json?.updatedAt);

  const accepted = await call(server, "/api/project", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Base-Revision": conflict.json?.currentRevision },
    body: JSON.stringify(project),
  });
  equal("matching revision saves", accepted.status, 200);
  truthy("save response carries the new revision", typeof accepted.json?.savedAt === "string" && accepted.json.savedAt.length > 0);

  /* ---- concurrent reads and writes (#8) ---------------------------------- */

  // A larger document keeps the read handle open long enough to overlap a
  // save on Windows; a tiny project makes the race too narrow to observe.
  const stressProject = {
    ...project,
    title: "Concurrent stress project",
    languages: [
      {
        ...project.languages[0],
        vocabulary: Array.from({ length: 20000 }, (_, index) => ({
          id: `word_${index}`,
          gloss: `gloss ${index}`,
          form: "kasa",
          note: "",
        })),
      },
    ],
  };
  const stressBody = JSON.stringify(stressProject);
  equal(
    "large project seed saves",
    (await call(server, "/api/project", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: stressBody,
    })).status,
    200
  );

  const concurrent = [];
  // Keep each batch small: the stdlib server's accept queue is short, and
  // firing every request at once can reset connections before the lock is
  // ever exercised. Repeating small mixed batches still overlaps reads and
  // writes many times.
  for (let round = 0; round < 10; round += 1) {
    const batch = [];
    for (let index = 0; index < 4; index += 1) {
      batch.push(call(server, "/api/project"));
      batch.push(
        call(server, "/api/project", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: stressBody,
        })
      );
    }
    concurrent.push(...(await Promise.all(batch)));
  }
  equal(
    "concurrent GET/PUT has no server errors",
    concurrent.filter((response) => response.status >= 500).map((response) => [response.status, response.json?.error]),
    []
  );
  equal(
    "concurrent reads and writes all succeed",
    concurrent.filter((response) => response.status !== 200).length,
    0
  );

  /* ---- methods and unknown routes (#15) ---------------------------------- */

  for (const method of ["POST", "DELETE", "OPTIONS", "PATCH"]) {
    const response = await call(server, "/api/project", { method });
    equal(`${method} /api/project returns 405 JSON`, [response.status, response.json?.error?.startsWith("Method not allowed.")], [405, true]);
  }

  const unknown = await call(server, "/api/nope");
  equal("unknown API endpoint is JSON 404", [unknown.status, unknown.json?.error], [404, "Unknown API endpoint."]);

  /* ---- Host check -------------------------------------------------------- */

  const badHost = await rawCall(server, { headers: { Host: "evil.example" } });
  equal("unexpected Host is refused", badHost.status, 403);
  equal("unexpected Host returns JSON", badHost.json?.error, "Unexpected Host header.");
} finally {
  await stopServer(server);
}

/* ---- summary ------------------------------------------------------------- */

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(1);
}
