const jsonHeaders = { "Content-Type": "application/json" };
const CAN_GZIP = typeof CompressionStream === "function";

function projectQuery(file) {
  return file ? `?file=${encodeURIComponent(file)}` : "";
}

function snapshotQuery(file, name = null) {
  const params = new URLSearchParams();
  if (file) params.set("file", file);
  if (name) params.set("name", name);
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function gzipBody(text) {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The server normally returns JSON; keep a useful fallback for hard failures.
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export const api = {
  // Every project lives in data/; the listing says which file is active and
  // includes enough metadata for the switcher without opening each document.
  listProjects() {
    return request("/api/projects");
  },
  selectProject(file) {
    return request("/api/projects/active", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ file }),
    });
  },
  // Create a blank project file and make it active. Creation never overwrites:
  // the server answers 409 when the file name is already taken.
  createProject(title, file) {
    return request("/api/projects", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ title, file }),
    });
  },
  loadProject(file = null) {
    return request(`/api/project${projectQuery(file)}`);
  },
  listSnapshots(file = null) {
    return request(`/api/snapshots${snapshotQuery(file)}`);
  },
  loadSnapshot(file, name) {
    return request(`/api/snapshots${snapshotQuery(file, name)}`);
  },
  // Restores a snapshot and returns the rewritten project document. The server
  // snapshots the current state first and bumps updatedAt, so other tabs get a
  // conflict instead of silently saving stale work over the restored file.
  restoreSnapshot(file, name, baseRevision = null) {
    const headers = { ...jsonHeaders };
    if (baseRevision) headers["X-Base-Revision"] = baseRevision;
    return request("/api/snapshots/restore", {
      method: "POST",
      headers,
      body: JSON.stringify({ file, name }),
    });
  },
  // baseRevision is the updatedAt stamp of the document this client last
  // saw. The server answers 409 when the file has been saved by someone else
  // (another tab) in the meantime, so a stale tab cannot silently overwrite
  // newer work. Omit it to save unconditionally. file pins the write to the
  // document this tab opened, so switching projects cannot redirect a save.
  async saveProject(project, baseRevision = null, file = null) {
    const headers = { ...jsonHeaders };
    if (baseRevision) headers["X-Base-Revision"] = baseRevision;
    let body = JSON.stringify(project);
    if (CAN_GZIP) {
      // The server caps the compressed size, so this buys ~6-10x more project
      // per PUT. The ArrayBuffer keeps Content-Length fixed (a stream body
      // would switch the request to chunked encoding).
      body = await gzipBody(body);
      headers["Content-Encoding"] = "gzip";
    }
    return request(`/api/project${projectQuery(file)}`, { method: "PUT", headers, body });
  },
  health() {
    return request("/api/health");
  },
};
