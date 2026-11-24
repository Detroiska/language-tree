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
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
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

  /* ---- creating projects ------------------------------------------------- */

  const createHeaders = { "Content-Type": "application/json" };
  const created = await call(server, "/api/projects", {
    method: "POST",
    headers: createHeaders,
    body: JSON.stringify({ title: "  Fresh family  ", file: "fresh_family.json" }),
  });
  equal("POST /api/projects creates a project", created.status, 201);
  equal("creation trims the title", created.json?.project?.title, "Fresh family");
  equal(
    "creation returns a blank version 1 document",
    [created.json?.project?.version, created.json?.project?.languages],
    [1, []]
  );
  truthy(
    "creation stamps the new document",
    typeof created.json?.project?.createdAt === "string" &&
      created.json.project.createdAt === created.json.project.updatedAt
  );
  equal("creation reports the new file", created.json?.file, "fresh_family.json");
  equal(
    "creation makes the new project active",
    (await call(server, "/api/projects")).json?.active,
    "fresh_family.json"
  );
  equal(
    "the created project opens through the API",
    (await call(server, "/api/project")).json?.title,
    "Fresh family"
  );

  const blankTitle = await call(server, "/api/projects", {
    method: "POST",
    headers: createHeaders,
    body: JSON.stringify({ file: "untitled_family.json", title: "   " }),
  });
  equal("creation accepts a blank title", blankTitle.status, 201);
  equal("a blank title uses the default", blankTitle.json?.project?.title, "Untitled language family");

  const missingTitle = await call(server, "/api/projects", {
    method: "POST",
    headers: createHeaders,
    body: JSON.stringify({ file: "missing_title.json" }),
  });
  equal("creation accepts a missing title", missingTitle.status, 201);
  equal("a missing title uses the default", missingTitle.json?.project?.title, "Untitled language family");

  const secondFamily = await call(server, "/api/projects", {
    method: "POST",
    headers: createHeaders,
    body: JSON.stringify({ file: "second_family.json", title: "Second family" }),
  });
  equal("creation can add a second project", secondFamily.status, 201);
  await call(server, "/api/project?file=second_family.json", {
    method: "PUT",
    headers: createHeaders,
    body: JSON.stringify({ ...project, title: "Keep me" }),
  });
  const duplicateCreate = await call(server, "/api/projects", {
    method: "POST",
    headers: createHeaders,
    body: JSON.stringify({ file: "second_family.json", title: "Replacement" }),
  });
  equal("creating an existing project is 409", duplicateCreate.status, 409);
  equal(
    "a duplicate does not overwrite the existing document",
    (await call(server, "/api/project?file=second_family.json")).json?.title,
    "Keep me"
  );
  equal(
    "a failed creation leaves the active project alone",
    (await call(server, "/api/projects")).json?.active,
    "second_family.json"
  );

  const directoryCollision = await call(server, "/api/projects", {
    method: "POST",
    headers: createHeaders,
    body: JSON.stringify({ file: "folder.json" }),
  });
  equal("creation refuses to replace a directory named .json", directoryCollision.status, 409);
  equal(
    "a directory named .json is not opened as a project",
    (await call(server, "/api/project?file=folder.json")).status,
    404
  );
  if (symlinkCreated) {
    const symlinkCollision = await call(server, "/api/projects", {
      method: "POST",
      headers: createHeaders,
      body: JSON.stringify({ file: "alias.json" }),
    });
    equal("creation refuses a symlinked project name", symlinkCollision.status, 400);
  }

  const dataBefore = readdirSync(join(server.root, "data")).sort();
  const invalidCreates = [
    ["a missing file name", { title: "No file" }, 400],
    ["a non-string file name", { file: 42 }, 400],
    ["a path outside data/", { file: "../outside.json" }, 400],
    ["a nested file name", { file: "nested/fresh.json" }, 400],
    ["a non-JSON file name", { file: "notes.txt" }, 400],
    ["a name with nothing before .json", { file: ".json" }, 400],
    // These pass project_path() on at least one platform but are not portable
    // file names. Windows treats ":" as an NTFS stream, and reserved device
    // names (CON, AUX, …) open devices instead of files.
    ["a name with a colon", { file: "colon:family.json" }, 400],
    ["a name with a question mark", { file: "what?.json" }, 400],
    ["a Windows reserved device name", { file: "con.json" }, 400],
    ["a reserved device name with a title", { file: "AUX.json", title: "Aux" }, 400],
    ["an uppercase extension with no name", { file: ".JSON" }, 400],
    ["a non-string title", { file: "number_title.json", title: 42 }, 400],
  ];
  for (const [label, body, status] of invalidCreates) {
    const response = await call(server, "/api/projects", {
      method: "POST",
      headers: createHeaders,
      body: JSON.stringify(body),
    });
    equal(`${label} is ${status}`, response.status, status);
    truthy(`${label} returns a JSON error`, typeof response.json?.error === "string");
  }

  const arrayBody = await call(server, "/api/projects", {
    method: "POST",
    headers: createHeaders,
    body: JSON.stringify([{ file: "array.json" }]),
  });
  equal("a non-object create body is 400", arrayBody.status, 400);
  const noBody = await call(server, "/api/projects", { method: "POST" });
  equal("an empty create body is 400", noBody.status, 400);

  equal(
    "failed creations leave the data directory unchanged",
    readdirSync(join(server.root, "data")).sort(),
    dataBefore
  );
  equal(
    "failed creations leave the active project alone",
    (await call(server, "/api/projects")).json?.active,
    "second_family.json"
  );

  /* ---- snapshot history -------------------------------------------------- */

  const historyFile = "history.json";
  const historyProject = {
    ...project,
    title: "History base",
    futureField: { keep: true },
  };
  writeFileSync(
    join(server.root, "data", historyFile),
    `${JSON.stringify(historyProject, null, 2)}\n`
  );
  const historyDir = () => join(server.root, "data", ".backups", historyFile);
  const historyNames = () => {
    try {
      return readdirSync(historyDir())
        .filter((name) => name.endsWith(".json"))
        .sort();
    } catch {
      return [];
    }
  };
  const backdateHistory = () => {
    const old = new Date(Date.now() - 11 * 60 * 1000);
    for (const name of historyNames()) utimesSync(join(historyDir(), name), old, old);
  };
  const readHistorySnapshot = (name) =>
    JSON.parse(readFileSync(join(historyDir(), name), "utf8"));
  const saveHistory = (title) =>
    call(server, `/api/project?file=${historyFile}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...historyProject, title }),
    });

  const firstSnapshotSave = await saveHistory("History one");
  equal("saving creates a snapshot of the previous document", firstSnapshotSave.status, 200);
  equal("a successful snapshot does not warn", firstSnapshotSave.json?.snapshotWarning, undefined);
  equal("the first snapshot is written", historyNames().length, 1);
  equal("the first snapshot holds the pre-save document", readHistorySnapshot(historyNames()[0]).title, "History base");

  await saveHistory("History two");
  equal("a second save inside the interval does not add a snapshot", historyNames().length, 1);

  backdateHistory();
  const thirdSnapshotSave = await saveHistory("History three");
  equal("a save after the interval snapshots again", thirdSnapshotSave.status, 200);
  equal("the second snapshot is written", historyNames().length, 2);
  equal("the new snapshot holds the previous save", readHistorySnapshot(historyNames()[1]).title, "History two");

  const historyListing = await call(server, `/api/snapshots?file=${historyFile}`);
  equal("GET /api/snapshots returns 200", historyListing.status, 200);
  equal("the listing names the project file", historyListing.json?.file, historyFile);
  equal("the listing reports the retention cap", historyListing.json?.keep, 20);
  equal("the listing reports the snapshot interval", historyListing.json?.intervalSeconds, 600);
  equal(
    "snapshots are listed newest first",
    historyListing.json?.snapshots?.map((snapshot) => snapshot.name),
    [...historyNames()].reverse()
  );
  truthy(
    "snapshot metadata carries size and time",
    historyListing.json?.snapshots?.every(
      (snapshot) => snapshot.size > 0 && /^\d{4}-\d{2}-\d{2}T/.test(snapshot.savedAt)
    )
  );

  const oldSnapshot = historyNames()[0];
  const readOldSnapshot = await call(
    server,
    `/api/snapshots?file=${historyFile}&name=${encodeURIComponent(oldSnapshot)}`
  );
  equal("GET /api/snapshots?name= returns a snapshot", readOldSnapshot.status, 200);
  equal("the snapshot document round-trips", readOldSnapshot.json?.title, "History base");
  equal("unknown fields survive a snapshot", readOldSnapshot.json?.futureField, { keep: true });

  const snapshotTraversal = await call(
    server,
    `/api/snapshots?file=${historyFile}&name=..%2Fhistory.json`
  );
  equal("snapshot names cannot traverse", snapshotTraversal.status, 400);
  const snapshotBackslash = await call(
    server,
    `/api/snapshots?file=${historyFile}&name=..%5Chistory.json`
  );
  equal("snapshot names cannot use backslashes", snapshotBackslash.status, 400);
  const missingSnapshot = await call(
    server,
    `/api/snapshots?file=${historyFile}&name=20000101T000000000000Z.json`
  );
  equal("a missing snapshot is 404", missingSnapshot.status, 404);
  const blankSnapshot = await call(server, `/api/snapshots?file=${historyFile}&name=`);
  equal("an empty snapshot selector is 400", blankSnapshot.status, 400);
  const missingSnapshotProject = await call(server, "/api/snapshots?file=missing.json");
  equal("snapshots of a missing project are 404", missingSnapshotProject.status, 404);
  const badSnapshotProject = await call(server, "/api/snapshots?file=..%2Fserver.py");
  equal("snapshots refuse project paths outside data/", badSnapshotProject.status, 400);

  const projectsWithSnapshots = await call(server, "/api/projects");
  equal(
    "snapshot files are never listed as projects",
    projectsWithSnapshots.json?.projects?.some((entry) => entry.file.includes(".backups")),
    false
  );
  equal(
    "the snapshotted project is still listed once",
    projectsWithSnapshots.json?.projects?.filter((entry) => entry.file === historyFile).length,
    1
  );

  const beforeRestore = await call(server, `/api/project?file=${historyFile}`);
  equal("the project holds the newest save before restoring", beforeRestore.json?.title, "History three");
  const restore = await call(server, "/api/snapshots/restore", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Base-Revision": beforeRestore.json?.updatedAt,
    },
    body: JSON.stringify({ file: historyFile, name: oldSnapshot }),
  });
  equal("POST /api/snapshots/restore restores a snapshot", restore.status, 200);
  equal("restore returns the restored document", restore.json?.project?.title, "History base");
  equal("restore preserves unknown fields", restore.json?.project?.futureField, { keep: true });
  truthy("restore reports the pre-restore backup", typeof restore.json?.snapshot === "string");
  truthy(
    "restore refreshes the revision stamp",
    restore.json?.savedAt &&
      restore.json.savedAt !== beforeRestore.json?.updatedAt &&
      restore.json.project?.updatedAt === restore.json.savedAt
  );
  equal(
    "the restored document is written to the project file",
    (await call(server, `/api/project?file=${historyFile}`)).json?.title,
    "History base"
  );
  equal("restoring forces a pre-restore snapshot", historyNames().length, 3);
  equal(
    "the pre-restore snapshot holds the replaced state",
    readHistorySnapshot(historyNames()[2]).title,
    "History three"
  );

  const staleRestore = await call(server, "/api/snapshots/restore", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Base-Revision": beforeRestore.json?.updatedAt,
    },
    body: JSON.stringify({ file: historyFile, name: historyNames()[1] }),
  });
  equal("restore with a stale revision is 409", staleRestore.status, 409);
  equal(
    "a refused restore leaves the project alone",
    (await call(server, `/api/project?file=${historyFile}`)).json?.title,
    "History base"
  );
  const restoreTraversal = await call(server, "/api/snapshots/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: historyFile, name: "../history.json" }),
  });
  equal("restore refuses a traversal name", restoreTraversal.status, 400);
  const restoreMissing = await call(server, "/api/snapshots/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: historyFile, name: "20000101T000000000000Z.json" }),
  });
  equal("restore of a missing snapshot is 404", restoreMissing.status, 404);

  const retentionFile = "retention.json";
  writeFileSync(
    join(server.root, "data", retentionFile),
    `${JSON.stringify({ ...project, title: "Retention base" }, null, 2)}\n`
  );
  const retentionDir = () => join(server.root, "data", ".backups", retentionFile);
  const retentionNames = () => readdirSync(retentionDir()).filter((name) => name.endsWith(".json")).sort();
  const saveRetention = (title) =>
    call(server, `/api/project?file=${retentionFile}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...project, title }),
    });
  for (let index = 0; index < 21; index += 1) {
    if (index > 0) {
      const old = new Date(Date.now() - 11 * 60 * 1000);
      for (const name of retentionNames()) utimesSync(join(retentionDir(), name), old, old);
    }
    await saveRetention(`Retention ${index}`);
  }
  equal("retention keeps the configured number of snapshots", retentionNames().length, 20);
  const retentionNewest = retentionNames()[19];
  equal(
    "retention drops the oldest snapshot first",
    JSON.parse(readFileSync(join(retentionDir(), retentionNewest), "utf8")).title,
    "Retention 19"
  );
  equal(
    "retention never keeps the dropped base snapshot",
    retentionNames().some(
      (name) => JSON.parse(readFileSync(join(retentionDir(), name), "utf8")).title === "Retention base"
    ),
    false
  );

  const blockedFile = "blocked_backup.json";
  writeFileSync(
    join(server.root, "data", blockedFile),
    `${JSON.stringify({ ...project, title: "Blocked base" }, null, 2)}\n`
  );
  // A file where the snapshot directory should be makes every snapshot fail.
  writeFileSync(join(server.root, "data", ".backups", blockedFile), "not a directory\n");
  const blockedSave = await call(server, `/api/project?file=${blockedFile}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...project, title: "Blocked save" }),
  });
  equal("a failed snapshot does not block the save", blockedSave.status, 200);
  truthy(
    "a failed snapshot is reported as a warning",
    typeof blockedSave.json?.snapshotWarning === "string" &&
      blockedSave.json.snapshotWarning.includes("backup snapshot")
  );
  equal(
    "the save lands even when its snapshot fails",
    (await call(server, `/api/project?file=${blockedFile}`)).json?.title,
    "Blocked save"
  );

  const quietFile = "quiet.json";
  writeFileSync(
    join(server.root, "data", quietFile),
    `${JSON.stringify({ ...project, title: "Quiet" }, null, 2)}\n`
  );
  const quietListing = await call(server, `/api/snapshots?file=${quietFile}`);
  equal(
    "a project without snapshots lists an empty history",
    [quietListing.status, quietListing.json?.snapshots],
    [200, []]
  );
  equal(
    "an empty history still reports the retention policy",
    [quietListing.json?.keep, quietListing.json?.intervalSeconds],
    [20, 600]
  );

  const corruptFile = "corrupt.json";
  writeFileSync(
    join(server.root, "data", corruptFile),
    `${JSON.stringify({ ...project, title: "Corrupt" }, null, 2)}\n`
  );
  mkdirSync(join(server.root, "data", ".backups", corruptFile), { recursive: true });
  const corruptName = "20260101T000000000000Z.json";
  writeFileSync(join(server.root, "data", ".backups", corruptFile, corruptName), "{ not json\n");
  const corruptRead = await call(server, `/api/snapshots?file=${corruptFile}&name=${corruptName}`);
  equal("a corrupt snapshot is a server error", corruptRead.status, 500);
  truthy(
    "a corrupt snapshot is reported as invalid",
    corruptRead.json?.error?.startsWith("Snapshot is not a valid project:")
  );
  const badRestoreBody = await call(server, "/api/snapshots/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: corruptFile }),
  });
  equal("restore requires a snapshot name", badRestoreBody.status, 400);
  const corruptRestore = await call(server, "/api/snapshots/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: corruptFile, name: corruptName }),
  });
  equal("restoring a corrupt snapshot fails", corruptRestore.status, 500);
  equal(
    "a failed restore leaves the project alone",
    (await call(server, `/api/project?file=${corruptFile}`)).json?.title,
    "Corrupt"
  );

  /* ---- snapshot hygiene and restore safety -------------------------------- */

  const hygieneFile = "hygiene.json";
  const hygieneProject = { ...project, title: "Hygiene base" };
  const hygieneText = `${JSON.stringify(hygieneProject, null, 2)}\n`;
  writeFileSync(join(server.root, "data", hygieneFile), hygieneText);
  const hygieneDir = join(server.root, "data", ".backups", hygieneFile);
  mkdirSync(hygieneDir, { recursive: true });
  const hygieneValid = "20260101T000000000000Z.json";
  const hygieneEmpty = "20260102T000000000000Z.json";
  const hygieneFolder = "20260103T000000000000Z.json";
  const hygieneSymlink = "20260104T000000000000Z.json";
  writeFileSync(join(hygieneDir, hygieneValid), hygieneText);
  writeFileSync(join(hygieneDir, hygieneEmpty), "");
  writeFileSync(join(hygieneDir, "notes.json"), hygieneText);
  mkdirSync(join(hygieneDir, hygieneFolder));
  if (symlinkCreated) {
    symlinkSync(join(hygieneDir, hygieneValid), join(hygieneDir, hygieneSymlink), "file");
  }
  const hygieneListing = await call(server, `/api/snapshots?file=${hygieneFile}`);
  equal(
    "only restorable snapshot files are listed",
    hygieneListing.json?.snapshots?.map((snapshot) => snapshot.name),
    [hygieneValid]
  );
  const emptyRead = await call(server, `/api/snapshots?file=${hygieneFile}&name=${hygieneEmpty}`);
  equal("an empty snapshot cannot be read", emptyRead.status, 404);
  const folderRead = await call(server, `/api/snapshots?file=${hygieneFile}&name=${hygieneFolder}`);
  equal("a folder named like a snapshot cannot be read", folderRead.status, 404);
  if (symlinkCreated) {
    const symlinkRead = await call(server, `/api/snapshots?file=${hygieneFile}&name=${hygieneSymlink}`);
    equal("a symlinked snapshot cannot be read", symlinkRead.status, 404);
  }
  const junkRead = await call(server, `/api/snapshots?file=${hygieneFile}&name=notes.json`);
  equal("a junk-named snapshot is refused", junkRead.status, 400);

  // Only the valid snapshot is old enough, but the empty file is fresh. A
  // zero-byte leftover must not suppress the next backup for a full interval.
  const hygieneOld = new Date(Date.now() - 11 * 60 * 1000);
  utimesSync(join(hygieneDir, hygieneValid), hygieneOld, hygieneOld);
  const hygieneSave = await call(server, `/api/project?file=${hygieneFile}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...hygieneProject, title: "Hygiene saved" }),
  });
  equal("the project with leftover snapshot files still saves", hygieneSave.status, 200);
  const hygieneAfter = await call(server, `/api/snapshots?file=${hygieneFile}`);
  equal("an empty snapshot does not suppress the next snapshot", hygieneAfter.json?.snapshots?.length, 2);
  equal(
    "the new snapshot holds the pre-save document",
    (await call(server, `/api/snapshots?file=${hygieneFile}&name=${hygieneAfter.json?.snapshots?.[0]?.name}`)).json
      ?.title,
    "Hygiene base"
  );

  // Retention must ignore zero-byte leftovers from interrupted writes. Seed one
  // valid snapshot with more empty snapshot-named files than the cap, save once,
  // and verify the leftovers do not evict the readable snapshot.
  const residueFile = "residue.json";
  const residueProject = { ...project, title: "Residue base" };
  const residueText = `${JSON.stringify(residueProject, null, 2)}\n`;
  writeFileSync(join(server.root, "data", residueFile), residueText);
  const residueDir = join(server.root, "data", ".backups", residueFile);
  mkdirSync(residueDir, { recursive: true });
  const residueValid = "20260101T000000000000Z.json";
  writeFileSync(join(residueDir, residueValid), residueText);
  const residueOld = new Date(Date.now() - 11 * 60 * 1000);
  utimesSync(join(residueDir, residueValid), residueOld, residueOld);
  for (let index = 0; index < 20; index += 1) {
    writeFileSync(join(residueDir, `20260102T000000${String(index).padStart(2, "0")}0000Z.json`), "");
  }
  const residueSave = await call(server, `/api/project?file=${residueFile}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...residueProject, title: "Residue saved" }),
  });
  equal("a project with many empty leftovers still saves", residueSave.status, 200);
  equal(
    "zero-byte leftovers do not evict the valid snapshot",
    readdirSync(residueDir).includes(residueValid),
    true
  );
  const residueListing = await call(server, `/api/snapshots?file=${residueFile}`);
  equal(
    "zero-byte leftovers do not consume the retention cap",
    residueListing.json?.snapshots?.length,
    2
  );
  equal(
    "the older valid snapshot is still readable",
    (await call(server, `/api/snapshots?file=${residueFile}&name=${residueValid}`)).json?.title,
    "Residue base"
  );

  // A restore must not proceed if the pre-restore backup fails: the live file
  // would otherwise be the only copy. Root can read a mode-000 file, so this
  // check only runs as a normal POSIX user; Windows ACLs do not map onto chmod.
  if (process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0) {
    const guardFile = "restore_guard.json";
    const guardPath = join(server.root, "data", guardFile);
    const guardDir = join(server.root, "data", ".backups", guardFile);
    const guardSnapshot = "20260101T000000000000Z.json";
    const guardProject = { ...project, title: "Restore guard" };
    const guardText = `${JSON.stringify(guardProject, null, 2)}\n`;
    mkdirSync(guardDir, { recursive: true });
    writeFileSync(guardPath, guardText);
    writeFileSync(
      join(guardDir, guardSnapshot),
      `${JSON.stringify({ ...guardProject, title: "Restore guard snapshot" }, null, 2)}\n`
    );
    chmodSync(guardPath, 0o000);
    try {
      const refused = await call(server, "/api/snapshots/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: guardFile, name: guardSnapshot }),
      });
      equal("restore refuses when its pre-restore snapshot fails", refused.status, 500);
      truthy(
        "a refused restore says the project was not changed",
        refused.json?.error?.includes("was not changed")
      );
    } finally {
      chmodSync(guardPath, 0o600);
    }
    equal("a refused restore leaves the project document alone", readFileSync(guardPath, "utf8"), guardText);
    equal("a refused restore leaves no partial snapshot", readdirSync(guardDir).sort(), [guardSnapshot]);
  }

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

  // A Host beginning with a colon normalizes to the empty string in a naive
  // host:port split, and the empty host is allowlisted for HTTP/1.0 clients.
  // Those malformed values must not inherit that exemption.
  const colonHost = await rawCall(server, { headers: { Host: ":evil.example" } });
  equal("a Host beginning with a colon is refused", colonHost.status, 403);
  const extraColonHost = await rawCall(server, { headers: { Host: "127.0.0.1:80:90" } });
  equal("a Host with extra colons is refused", extraColonHost.status, 403);
  const bracketedV6 = await rawCall(server, { headers: { Host: "[::1]:8765" } });
  equal("a bracketed IPv6 loopback Host is still accepted", bracketedV6.status, 200);

  // The banner and browser-launch URL must bracket an IPv6 literal.
  const urlForHost = (host, port) => {
    const probe = spawnSync(
      python,
      [
        "-c",
        [
          "import sys",
          `sys.path.insert(0, ${JSON.stringify(server.root)})`,
          "import server",
          `print(server.url_for_host(${JSON.stringify(host)}, ${port}))`,
        ].join("\n"),
      ],
      { cwd: server.root, encoding: "utf8" }
    );
    if (probe.status !== 0) throw new Error(probe.stderr || probe.stdout);
    return probe.stdout.trim();
  };
  equal("IPv4 loopback URL", urlForHost("127.0.0.1", 8765), "http://127.0.0.1:8765/");
  equal("IPv6 loopback URL brackets the literal", urlForHost("::1", 8765), "http://[::1]:8765/");

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
