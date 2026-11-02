const jsonHeaders = { "Content-Type": "application/json" };

async function request(url, options = {}) {
  const response = await fetch(url, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The server normally returns JSON; keep a useful fallback for hard failures.
  }
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status}).`);
  }
  return payload;
}

export const api = {
  loadProject() {
    return request("/api/project");
  },
  saveProject(project) {
    return request("/api/project", {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(project),
    });
  },
  health() {
    return request("/api/health");
  },
};
