const jsonHeaders = { "Content-Type": "application/json" };
const CAN_GZIP = typeof CompressionStream === "function";

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
  loadProject() {
    return request("/api/project");
  },
  // baseRevision is the updatedAt stamp of the document this client last
  // saw. The server answers 409 when the file has been saved by someone else
  // (another tab) in the meantime, so a stale tab cannot silently overwrite
  // newer work. Omit it to save unconditionally.
  async saveProject(project, baseRevision = null) {
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
    return request("/api/project", { method: "PUT", headers, body });
  },
  health() {
    return request("/api/health");
  },
};
