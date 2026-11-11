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
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, request as httpRequest } from "node:http";
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

function truthy(name, condition, detail = "") {
  if (condition) passed += 1;
  else failures.push(`${name}\n    expected a truthy result${detail ? `\n    actual:   ${detail}` : ""}`);
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

async function startServer(python, files = { "project.json": project }, sharedRoot = null) {
  let root = sharedRoot;
  if (!root) {
    root = mkdtempSync(join(tmpdir(), "language-tree-server-"));
    copyFileSync(SERVER_PY, join(root, "server.py"));
    mkdirSync(join(root, "data"), { recursive: true });
    mkdirSync(join(root, "web"), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(
        join(root, "data", name),
        typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`
      );
    }
    writeFileSync(join(root, "web", "index.html"), "<!doctype html><title>Language Tree test</title>\n");
  }

  const child = spawn(python, ["-u", join(root, "server.py"), "--no-browser", "--port", "0"], {
    cwd: root,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const logs = { stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    logs.stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs.stderr += chunk;
  });
  child.on("error", (error) => {
    logs.stderr += `\nspawn error: ${error.message}\n`;
  });

  let url;
  try {
    url = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Server did not start in time.\n${logs.stdout}\n${logs.stderr}`)),
        15000
      );
      const onStdout = () => {
        const match = logs.stdout.match(/http:\/\/[^\s]+/);
        if (match) {
          clearTimeout(timer);
          child.stdout.off("data", onStdout);
          resolve(match[0].replace(/\/$/, ""));
        }
      };
      child.stdout.on("data", onStdout);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Server exited with ${code} before listening.\n${logs.stdout}\n${logs.stderr}`));
      });
    });
  } catch (error) {
    await stopServer({ root, child }, { removeRoot: !sharedRoot });
    throw error;
  }

  // The banner is printed after the socket binds, but Windows can still race
  // the first request. Wait for health so a failed start reports the child's
  // output instead of a bare ECONNREFUSED.
  const deadline = Date.now() + 5000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return { root, child, url, output: () => ({ ...logs }) };
      lastError = new Error(`/api/health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await stopServer({ root, child }, { removeRoot: !sharedRoot });
  throw new Error(
    `Server did not answer /api/health (exit ${child.exitCode}).\n${lastError}\n${logs.stdout}\n${logs.stderr}`
  );
}

async function stopServer(server, { removeRoot = true } = {}) {
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
  // A second process may still use the shared directory as its cwd; the last
  // owner of the root removes it.
  if (removeRoot) rmSync(server.root, { recursive: true, force: true });
}

function spawnServer(python, root, port) {
  const child = spawn(python, ["-u", join(root, "server.py"), "--no-browser", "--port", String(port)], {
    cwd: root,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return { child, output: () => ({ stdout, stderr }) };
}

function waitForExit(started, timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (started.child.exitCode !== null) {
      resolve({ code: started.child.exitCode, timedOut: false, ...started.output() });
      return;
    }
    const timer = setTimeout(() => {
      started.child.kill("SIGKILL");
      resolve({ code: null, timedOut: true, ...started.output() });
    }, timeout);
    started.child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    started.child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut: false, ...started.output() });
    });
  });
}

async function call(server, path, options = {}) {
  let response;
  try {
    response = await fetch(`${server.url}${path}`, { redirect: "manual", ...options });
  } catch (error) {
    const output = server.output ? server.output() : { stdout: "", stderr: "" };
    const cause = error?.cause ? ` (${error.cause.code || error.cause.message || error.cause})` : "";
    throw new Error(
      `Request to ${server.url}${path} failed: ${error}${cause}\n${output.stdout}\n${output.stderr}`
    );
  }
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
    request.on("error", (error) => {
      const output = server.output ? server.output() : { stdout: "", stderr: "" };
      reject(new Error(`Request to ${server.url}${path} failed: ${error}\n${output.stdout}\n${output.stderr}`));
    });
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

  let nestedJson;
  try {
    nestedJson = await call(server, "/api/project", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "[".repeat(60000) + "]".repeat(60000),
    });
  } catch {
    // Before the fix the handler thread dies and drops the connection.
    nestedJson = { status: 0, json: null };
  }
  equal("deeply nested JSON is 400 instead of a dropped connection", nestedJson.status, 400);
  truthy(
    "deeply nested JSON returns the error envelope",
    typeof nestedJson.json?.error === "string" && nestedJson.json.error.length > 0,
    JSON.stringify(nestedJson)
  );

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
  equal(
    "atomic saves leave no temporary files behind",
    readdirSync(join(server.root, "data")).filter((name) => name.endsWith(".tmp")),
    []
  );

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

  /* ---- project files ----------------------------------------------------- */

  const secondProject = {
    ...project,
    title: "Second project",
  };
  writeFileSync(
    join(server.root, "data", "second_project.json"),
    `${JSON.stringify(secondProject, null, 2)}\n`
  );
  writeFileSync(join(server.root, "data", "broken.json"), "{");
  writeFileSync(
    join(server.root, "data", "shape.json"),
    `${JSON.stringify({ languages: [] }, null, 2)}\n`
  );
  mkdirSync(join(server.root, "data", "folder.json"));
  let symlinkCreated = false;
  try {
    symlinkSync(join(server.root, "data", "project.json"), join(server.root, "data", "alias.json"), "file");
    symlinkCreated = true;
  } catch {
    // Windows may require developer mode or elevation for symlinks.
  }

  const projects = await call(server, "/api/projects");
  equal("GET /api/projects returns 200", projects.status, 200);
  equal(
    "GET /api/projects lists every data/*.json file",
    projects.json?.projects?.map((entry) => entry.file),
    ["broken.json", "project.json", "second_project.json", "shape.json"]
  );
  equal("GET /api/projects reports the active file", projects.json?.active, "project.json");
  equal(
    "GET /api/projects marks malformed JSON",
    typeof projects.json?.projects?.find((entry) => entry.file === "broken.json")?.error,
    "string"
  );
  equal(
    "GET /api/projects marks invalid project shapes",
    /title/.test(projects.json?.projects?.find((entry) => entry.file === "shape.json")?.error || ""),
    true
  );
  equal(
    "GET /api/projects skips directories with a .json name",
    projects.json?.projects?.some((entry) => entry.file === "folder.json"),
    false
  );
  if (symlinkCreated) {
    equal(
      "GET /api/projects skips symlinked projects",
      projects.json?.projects?.some((entry) => entry.file === "alias.json"),
      false
    );
  }

  const directoryProject = await call(server, "/api/project?file=folder.json");
  equal("a non-regular project file is not opened", directoryProject.status, 404);
  if (symlinkCreated) {
    const linkedProject = await call(server, "/api/project?file=alias.json");
    equal("a skipped symlink is not openable under its link name", linkedProject.status, 400);
  }

  const selectHeaders = { "Content-Type": "application/json" };
  const selected = await call(server, "/api/projects/active", {
    method: "PUT",
    headers: selectHeaders,
    body: JSON.stringify({ file: "second_project.json" }),
  });
  equal("PUT /api/projects/active selects an existing project", selected.status, 200);
  equal("selection reports the active file", selected.json?.active, "second_project.json");
  equal(
    "GET /api/project follows the selected file",
    (await call(server, "/api/project")).json?.title,
    secondProject.title
  );

  const explicitSave = await call(server, "/api/project?file=project.json", {
    method: "PUT",
    headers: selectHeaders,
    body: JSON.stringify({ ...project, title: "Explicit save" }),
  });
  equal("PUT /api/project?file= saves that file", explicitSave.status, 200);
  equal("save reports its target file", explicitSave.json?.file, "project.json");
  equal(
    "explicit save leaves the active project alone",
    (await call(server, "/api/project")).json?.title,
    secondProject.title
  );
  equal(
    "explicit save writes the selected target",
    (await call(server, "/api/project?file=project.json")).json?.title,
    "Explicit save"
  );

  const rejectBroken = await call(server, "/api/projects/active", {
    method: "PUT",
    headers: selectHeaders,
    body: JSON.stringify({ file: "broken.json" }),
  });
  equal("selecting malformed JSON is 400", rejectBroken.status, 400);
  truthy("selecting malformed JSON explains the problem", /Invalid JSON|Expecting/.test(rejectBroken.json?.error || ""));
  const rejectShape = await call(server, "/api/projects/active", {
    method: "PUT",
    headers: selectHeaders,
    body: JSON.stringify({ file: "shape.json" }),
  });
  equal("selecting an invalid project shape is 400", rejectShape.status, 400);
  truthy("invalid project shape names the missing title", /title/.test(rejectShape.json?.error || ""));
  const rejectPath = await call(server, "/api/projects/active", {
    method: "PUT",
    headers: selectHeaders,
    body: JSON.stringify({ file: "../server.py" }),
  });
  equal("selecting a path outside data/ is 400", rejectPath.status, 400);
  const rejectMissing = await call(server, "/api/projects/active", {
    method: "PUT",
    headers: selectHeaders,
    body: JSON.stringify({ file: "missing.json" }),
  });
  equal("selecting a missing project is 404", rejectMissing.status, 404);
  const rejectBody = await call(server, "/api/projects/active", {
    method: "PUT",
    headers: selectHeaders,
    body: JSON.stringify({ file: 42 }),
  });
  equal("selection requires a filename string", rejectBody.status, 400);
  equal(
    "failed selections keep the previous active project",
    (await call(server, "/api/project")).json?.title,
    secondProject.title
  );

  const badProjectQuery = await call(server, "/api/project?file=../server.py");
  equal("GET /api/project refuses paths outside data/", badProjectQuery.status, 400);
  const blankProjectQuery = await call(server, "/api/project?file=");
  equal("GET /api/project refuses an empty file selector", blankProjectQuery.status, 400);
  const missingProjectQuery = await call(server, "/api/project?file=missing.json");
  equal("GET /api/project reports a missing file", missingProjectQuery.status, 404);

  // Root can read a mode-000 file, so this check only runs as a normal POSIX
  // user. Windows ACLs do not map onto chmod, so it is skipped there.
  if (process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0) {
    const lockedPath = join(server.root, "data", "locked.json");
    writeFileSync(lockedPath, `${JSON.stringify(project, null, 2)}\n`);
    chmodSync(lockedPath, 0o000);
    try {
      const denied = await call(server, "/api/project?file=locked.json");
      equal(
        "an unreadable project returns a generic error",
        [denied.status, denied.json?.error],
        [500, "Could not read the project file."]
      );
      truthy("a read error does not leak the data path", !denied.text.includes(server.root));
      const deniedList = await call(server, "/api/projects");
      equal(
        "a listing error does not leak the data path",
        deniedList.json?.projects?.find((entry) => entry.file === "locked.json")?.error,
        "Could not read the project file."
      );
    } finally {
      chmodSync(lockedPath, 0o600);
    }
  }

  /* ---- fresh data directory ---------------------------------------------- */

  const fresh = await startServer(python, {});
  try {
    const freshProjects = await call(fresh, "/api/projects");
    equal(
      "a fresh data directory gets a blank example project",
      freshProjects.json?.projects?.map((entry) => entry.file),
      ["example_project.json"]
    );
    equal("the seeded example is active", freshProjects.json?.active, "example_project.json");
    equal("the seeded example is blank", freshProjects.json?.projects?.[0]?.languages, 0);
    equal(
      "the seeded example loads through the API",
      (await call(fresh, "/api/project")).json?.title,
      "Example language family"
    );
  } finally {
    await stopServer(fresh);
  }

  /* ---- methods and unknown routes (#15) ---------------------------------- */

  for (const method of ["POST", "DELETE", "OPTIONS", "PATCH"]) {
    const response = await call(server, "/api/project", { method });
    equal(`${method} /api/project returns 405 JSON`, [response.status, response.json?.error?.startsWith("Method not allowed.")], [405, true]);
  }
  // fetch refuses TRACE, so the raw client covers the inherited stdlib verb.
  const trace = await rawCall(server, { method: "TRACE", path: "/api/project" });
  equal(
    "TRACE /api/project returns 405 JSON",
    [trace.status, trace.json?.error?.startsWith("Method not allowed.")],
    [405, true]
  );

  const unknown = await call(server, "/api/nope");
  equal("unknown API endpoint is JSON 404", [unknown.status, unknown.json?.error], [404, "Unknown API endpoint."]);

  /* ---- Host check -------------------------------------------------------- */

  const badHost = await rawCall(server, { headers: { Host: "evil.example" } });
  equal("unexpected Host is refused", badHost.status, 403);
  equal("unexpected Host returns JSON", badHost.json?.error, "Unexpected Host header.");

  const badHeadHost = await rawCall(server, {
    method: "HEAD",
    path: "/index.html",
    headers: { Host: "evil.example" },
  });
  equal("HEAD checks the Host header too", badHeadHost.status, 403);
  equal("HEAD rejects with the JSON envelope", badHeadHost.headers["content-type"], "application/json; charset=utf-8");
  equal("HEAD sends no JSON error body", badHeadHost.text, "");
  equal(
    "HEAD reports the GET body length without sending it",
    badHeadHost.headers["content-length"],
    badHost.headers["content-length"]
  );
  const goodHead = await rawCall(server, { method: "HEAD", path: "/index.html" });
  equal("HEAD still serves static metadata", goodHead.status, 200);

  /* ---- duplicate server prevention -------------------------------------- */

  // Windows SO_REUSEADDR lets a second process bind an occupied port, so two
  // servers end up splitting requests; stale instances then answer the page
  // shell while failing the API. A repeat launch must refuse instead.
  const duplicate = spawnServer(python, server.root, new URL(server.url).port);
  const duplicateExit = await waitForExit(duplicate);
  equal(
    "a second server on the same port exits instead of sharing it",
    [duplicateExit.code, duplicateExit.timedOut],
    [0, false]
  );
  truthy(
    "the second server explains that the app is already running",
    /already running/i.test(duplicateExit.stdout)
  );
  truthy(
    "the second server does not reach the listening banner",
    !/Press Ctrl\+C to stop/.test(duplicateExit.stdout)
  );

  // A port owned by an unrelated program must fail clearly, not half-start.
  const blocker = createServer((request, response) => {
    response.statusCode = 404;
    response.end("not Language Tree");
  });
  const blockerPort = await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", () => resolve(blocker.address().port));
  });
  try {
    const blocked = spawnServer(python, server.root, blockerPort);
    const blockedExit = await waitForExit(blocked);
    equal(
      "a port owned by another program is refused",
      [blockedExit.code, blockedExit.timedOut],
      [1, false]
    );
    truthy(
      "the port-in-use error is actionable",
      /Cannot start[\s\S]*already in use/i.test(blockedExit.stdout + blockedExit.stderr)
    );
  } finally {
    blocker.closeAllConnections?.();
    await new Promise((resolve) => blocker.close(resolve));
  }

  /* ---- Windows sharing violations --------------------------------------- */

  if (process.platform === "win32") {
    // Force two transient os.replace() failures so the retry path is exercised
    // deterministically, not only when two real saves happen to collide.
    const retry = spawnSync(
      python,
      [
        "-c",
        [
          "import os, sys",
          `sys.path.insert(0, ${JSON.stringify(server.root)})`,
          "import server",
          "calls = 0",
          "real_replace = os.replace",
          "def flaky(source, destination):",
          "    global calls",
          "    calls += 1",
          "    if calls < 3:",
          "        raise PermissionError(13, 'Access is denied')",
          "    return real_replace(source, destination)",
          "os.replace = flaky",
          "path = server.DATA_DIR / 'retry.json'",
          "server.atomic_write_text(path, '{\"ok\": true}\\n')",
          "print(calls)",
          "print(path.read_text(encoding='utf-8').strip())",
        ].join("\n"),
      ],
      { cwd: server.root, encoding: "utf8", windowsHide: true }
    );
    truthy("the sharing-violation probe exits cleanly", retry.status === 0, retry.stderr);
    const [calls, contents] = retry.stdout.trim().split(/\r?\n/);
    equal("a Windows sharing violation is retried", calls, "3");
    equal("the retried write lands", contents, '{"ok": true}');
  }

  /* ---- two instances sharing one data directory (#57) -------------------- */

  const shared = await startServer(python, { "shared.json": project });
  const peer = await startServer(python, {}, shared.root);
  try {
    const sharedPayload = JSON.stringify({
      ...project,
      title: "Shared save",
      languages: [
        {
          ...project.languages[0],
          vocabulary: Array.from({ length: 4000 }, (_, index) => ({
            id: `shared_${index}`,
            gloss: `gloss ${index}`,
            form: "kasa",
            note: "",
          })),
        },
      ],
    });
    // The two processes have separate SAVE_LOCKs, so Windows can reject one
    // os.replace() while the other renames onto the same file. The server
    // retries those transient sharing violations; sixteen saves make the race
    // likely enough to catch a regression.
    const saves = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        call(index % 2 ? peer : shared, "/api/project?file=shared.json", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: sharedPayload,
        })
      )
    );
    equal(
      "two server instances save the same project without errors",
      saves.filter((response) => response.status !== 200).map((response) => [response.status, response.json?.error]),
      []
    );
  } finally {
    await stopServer(peer, { removeRoot: false });
    await stopServer(shared);
  }
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
