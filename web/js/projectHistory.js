import { store } from "./store.js";
import { esc, icon, openModal, toast } from "./ui.js";

// The Project history dialog: snapshots the server keeps beside the project
// file. Restoring is confirmed inline so the list stays visible when the user
// changes their mind; downloading fetches one snapshot and saves it as JSON.

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "Unknown time";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadName(snapshot) {
  const stem = String(store.projectFile || "project")
    .replace(/\.json$/i, "")
    .replace(/[^\w-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "project";
  return `${stem}-${snapshot.name}`;
}

function rowMarkup(snapshot) {
  const name = esc(snapshot.name);
  return `
    <li class="history-row" data-history-row="${name}">
      <div class="history-when">
        <strong>${esc(formatWhen(snapshot.savedAt))}</strong>
        <span>${esc(formatSize(snapshot.size))}</span>
      </div>
      <div class="history-actions">
        <button class="button button-quiet button-small" type="button" data-history-download="${name}" title="Download this snapshot as JSON">${icon("download")}Download</button>
        <button class="button button-quiet button-small" type="button" data-history-restore="${name}" title="Replace the project with this snapshot">${icon("refresh")}Restore</button>
      </div>
    </li>`;
}

function confirmMarkup(snapshot, error) {
  return `
    <li class="history-row history-row-confirm">
      <div class="history-confirm-copy">
        <strong>Restore the snapshot from ${esc(formatWhen(snapshot.savedAt))}?</strong>
        <p>This replaces the current project. The current state is saved as a new snapshot first, so the restore is recoverable.</p>
        ${error ? `<p class="history-error" role="alert">${esc(error)}</p>` : ""}
      </div>
      <div class="history-actions">
        <button class="button button-quiet button-small" type="button" data-history-cancel>Cancel</button>
        <button class="button button-danger button-small" type="button" data-history-confirm>Restore snapshot</button>
      </div>
    </li>`;
}

function emptyMarkup() {
  return `
    <div class="history-empty">
      <p><strong>No snapshots yet.</strong></p>
      <p>A snapshot is taken before a save replaces the project file. The first one appears after the next save.</p>
    </div>`;
}

async function downloadSnapshot(snapshot) {
  try {
    const snapshotDocument = await store.loadSnapshot(snapshot.name);
    const name = downloadName(snapshot);
    const blob = new Blob([`${JSON.stringify(snapshotDocument, null, 2)}\n`], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Downloading ${name}.`, { type: "success", duration: 3200 });
  } catch (error) {
    toast(error.message || "Could not download the snapshot.", { type: "error", duration: 6000 });
  }
}

export async function openProjectHistory({ onRestored = null } = {}) {
  if (!store.projectFile) return;
  let listing;
  try {
    listing = await store.listSnapshots();
  } catch (error) {
    toast(error.message || "Could not load the project history.", { type: "error", duration: 6000 });
    return;
  }
  const snapshots = Array.isArray(listing?.snapshots) ? listing.snapshots : [];
  const keep = Number.isInteger(listing?.keep) ? listing.keep : null;
  const intervalMinutes = Number.isFinite(listing?.intervalSeconds)
    ? Math.max(1, Math.round(listing.intervalSeconds / 60))
    : null;
  const policy = [
    intervalMinutes ? `at most once every ${intervalMinutes} minutes` : "",
    keep ? `the newest ${keep} are kept` : "",
  ]
    .filter(Boolean)
    .join("; ");

  openModal({
    title: "Project history",
    width: "wide",
    body: `
      <div class="history-modal">
        <p class="modal-copy">
          Snapshots of <strong>${esc(store.projectFile)}</strong> are taken automatically before a save replaces the file${policy ? ` — ${esc(policy)}` : ""}.
        </p>
        <div class="history-body" data-history-body></div>
      </div>
    `,
    footer: `<button type="button" class="button button-quiet" data-close>Close</button>`,
    onMount({ root, close }) {
      const body = root.querySelector("[data-history-body]");
      let pendingName = null;
      let pendingError = "";
      let busy = false;

      const findSnapshot = (name) => snapshots.find((snapshot) => snapshot.name === name);

      const render = () => {
        const pending = pendingName ? findSnapshot(pendingName) : null;
        if (pending) {
          body.innerHTML = `<ul class="history-list">${confirmMarkup(pending, pendingError)}</ul>`;
          window.setTimeout(() => body.querySelector("[data-history-confirm]")?.focus(), 60);
          return;
        }
        body.innerHTML = snapshots.length
          ? `<ul class="history-list">${snapshots.map(rowMarkup).join("")}</ul>`
          : emptyMarkup();
      };

      const restore = async () => {
        const snapshot = pendingName ? findSnapshot(pendingName) : null;
        if (!snapshot || busy) return;
        busy = true;
        pendingError = "";
        const confirm = body.querySelector("[data-history-confirm]");
        if (confirm) {
          confirm.disabled = true;
          confirm.textContent = "Restoring…";
        }
        try {
          const result = await store.restoreSnapshot(snapshot.name);
          close();
          onRestored?.(result);
          toast(
            `Restored the snapshot from ${formatWhen(snapshot.savedAt)}. The previous state was saved as a new snapshot.`,
            { type: "success", duration: 6000 }
          );
        } catch (error) {
          busy = false;
          pendingError = error.message || String(error);
          render();
        }
      };

      body.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button || busy) return;
        if (button.hasAttribute("data-history-download")) {
          const snapshot = findSnapshot(button.dataset.historyDownload);
          if (snapshot) void downloadSnapshot(snapshot);
          return;
        }
        if (button.hasAttribute("data-history-restore")) {
          pendingName = button.dataset.historyRestore;
          pendingError = "";
          render();
          return;
        }
        if (button.hasAttribute("data-history-cancel")) {
          const name = pendingName;
          pendingName = null;
          pendingError = "";
          render();
          body.querySelector(`[data-history-restore="${CSS.escape(name || "")}"]`)?.focus();
          return;
        }
        if (button.hasAttribute("data-history-confirm")) void restore();
      });

      root.querySelector("[data-close]").addEventListener("click", close);
      render();
    },
  });
}
