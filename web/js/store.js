import { api } from "./api.js";
import { deepClone, ensureProject } from "./model.js";

const SAVE_DELAY = 280;
// Rapid edits (keystrokes in one field, quick consecutive actions) merge into
// a single undo step; a pause longer than this starts a new step.
const HISTORY_COALESCE_MS = 500;
// Snapshots are deep-cloned full documents; keep the stack bounded.
const HISTORY_LIMIT = 100;
// Keepalive request bodies are capped by browsers at 64 KiB in bytes, not
// UTF-16 code units. Leave a little room for the request envelope, and measure
// the encoded body so an IPA-heavy document cannot slip past the gate and have
// an oversized request fail silently.
const KEEPALIVE_BYTE_LIMIT = 60000;

class ProjectStore {
  project = null;
  route = { view: "tree" };
  revision = 0;
  savedRevision = 0;
  saving = false;
  saveState = "loading";
  saveError = "";
  lastSavedAt = null;
  // The updatedAt stamp of the document this tab last saw (loaded or saved).
  // Sent back on save so the server can reject a PUT that would overwrite
  // newer work from another tab; null disables the check (force saves).
  baseRevision = null;
  // #undoStack holds per-burst pre-edit states to undo into; #redoStack holds
  // states to redo into after an undo. #lastState is the pre-edit state of
  // the burst currently in progress; it becomes the next undo step on the
  // next burst boundary. Entries carry the label of the edit that produced
  // them so undo/redo can tell the user what just happened.
  #undoStack = [];
  #redoStack = [];
  #lastState = null;
  #lastTouchAt = 0;
  #lastLabel = null;
  #lastCoalesceKey = null;
  #recording = false;
  #timer = null;
  #inFlight = false;
  #pending = false;
  #pendingForce = false;
  #statusListeners = new Set();
  #historyListeners = new Set();
  #resyncListeners = new Set();

  // The optional raw document lets the resync path apply the exact snapshot it
  // checked instead of fetching again. When ifClean is true, the caller is
  // replacing a background document: abort if any edit, save, or dialog
  // appeared while the snapshot was in flight, so local work is never lost.
  async load(raw = null, { ifClean = false } = {}) {
    const revisionAtStart = this.revision;
    const wasDirty = this.dirty;
    const remote = raw ?? (await api.loadProject());
    if (ifClean) {
      if (wasDirty || this.dirty || this.revision !== revisionAtStart || this.#inFlight) return false;
      if (document.body.classList.contains("has-modal")) return false;
    }
    this.baseRevision = typeof remote?.updatedAt === "string" ? remote.updatedAt : null;
    const before = JSON.stringify(remote);
    this.project = ensureProject(remote);
    const after = JSON.stringify(this.project);
    this.revision = 0;
    this.savedRevision = 0;
    this.#undoStack = [];
    this.#redoStack = [];
    // The loader's normalizing save is not a user edit and must not become an
    // undo step, including when a background resync replaces the document.
    this.#recording = false;
    this.#lastState = deepClone(this.project);
    this.setSaveState("saved");
    if (before !== after || !remote.languages?.length) {
      this.touch({ immediate: true });
    }
    // History starts only after loading: the loader's normalizing save is not
    // an edit the user made, so nothing should be undoable past this point.
    this.#lastState = deepClone(this.project);
    this.#lastTouchAt = 0;
    this.#lastLabel = null;
    this.#lastCoalesceKey = null;
    this.#recording = true;
    this.#notifyHistory();
    return this.project;
  }

  touch(options = {}) {
    if (!this.project) return;
    this.revision += 1;
    this.project.updatedAt = new Date().toISOString();
    if (this.#recording) this.#recordHistory(options.label, options.coalesceKey);
    if (this.saveState === "conflict") {
      // Keep the conflict visible until the user explicitly reloads or
      // overwrites; retrying every keystroke would just repeat the same 409.
      this.setSaveState("conflict");
      return;
    }
    this.setSaveState(this.#inFlight ? "saving" : "pending");
    if (options.immediate) {
      this.flush();
      return;
    }
    window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => this.flush(), SAVE_DELAY);
  }

  // Called after a mutation (views edit first, then call touch()): pushes the
  // pre-edit state as an undo step unless this edit continues an active burst.
  // A label describes the edit for undo/redo feedback; bursts only coalesce
  // while the label and the optional coalesce key stay the same, so a different
  // action — or the same label on a different word/rule — always starts a new
  // undo step even inside the time window.
  #recordHistory(label = null, coalesceKey = null) {
    const now = Date.now();
    const key = coalesceKey || null;
    const coalesce =
      this.#undoStack.length > 0 &&
      now - this.#lastTouchAt <= HISTORY_COALESCE_MS &&
      label === this.#lastLabel &&
      key === this.#lastCoalesceKey;
    if (!coalesce) {
      this.#undoStack.push({ document: this.#lastState, time: now, label: label || null });
      if (this.#undoStack.length > HISTORY_LIMIT) this.#undoStack.shift();
      this.#redoStack = [];
    }
    this.#lastTouchAt = now;
    this.#lastLabel = label || null;
    this.#lastCoalesceKey = key;
    this.#lastState = deepClone(this.project);
    this.#notifyHistory();
  }

  canUndo() {
    return this.#undoStack.length > 0;
  }

  canRedo() {
    return this.#redoStack.length > 0;
  }

  // Both return null when there is nothing to do, otherwise an outcome
  // object carrying the label of the change that was undone / redone.
  undo() {
    if (!this.project || !this.#undoStack.length) return null;
    const entry = this.#undoStack.pop();
    this.#redoStack.push({ document: deepClone(this.project), time: Date.now(), label: entry.label });
    this.#applyHistory(entry.document);
    return { label: entry.label };
  }

  redo() {
    if (!this.project || !this.#redoStack.length) return null;
    const entry = this.#redoStack.pop();
    this.#undoStack.push({ document: deepClone(this.project), time: Date.now(), label: entry.label });
    if (this.#undoStack.length > HISTORY_LIMIT) this.#undoStack.shift();
    this.#applyHistory(entry.document);
    return { label: entry.label, redo: true };
  }

  // Restoring a snapshot is a document change like any other: it marks the
  // store dirty so the reverted state is written back to the project file,
  // but it never adds another history step of its own.
  #applyHistory(document) {
    this.project = deepClone(document);
    this.#lastState = deepClone(this.project);
    this.#lastTouchAt = 0;
    this.#lastLabel = null;
    this.#lastCoalesceKey = null;
    this.revision += 1;
    this.project.updatedAt = new Date().toISOString();
    if (this.saveState === "conflict") {
      this.setSaveState("conflict");
      this.#notifyHistory();
      return;
    }
    this.setSaveState(this.#inFlight ? "saving" : "pending");
    window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => this.flush(), SAVE_DELAY);
    this.#notifyHistory();
  }

  async flush(options = {}) {
    const { force = false } = options;
    window.clearTimeout(this.#timer);
    if (!this.project) return;
    if (this.#inFlight) {
      this.#pending = true;
      if (force) this.#pendingForce = true;
      return;
    }
    if (this.savedRevision === this.revision) {
      this.setSaveState("saved");
      return;
    }
    this.#inFlight = true;
    this.saving = true;
    this.setSaveState("saving");
    const revisionAtStart = this.revision;
    const snapshot = JSON.parse(JSON.stringify(this.project));
    let saved = false;
    try {
      const result = await api.saveProject(snapshot, force ? null : this.baseRevision);
      saved = true;
      this.savedRevision = revisionAtStart;
      this.baseRevision = result?.savedAt || this.baseRevision;
      // Adopt the server's stamp so the in-memory document matches what was
      // actually written (the server is the authority on save time). Kept on
      // the store so the save indicator can show when the last save happened.
      this.lastSavedAt = result?.savedAt || null;
      if (result?.savedAt) this.project.updatedAt = result.savedAt;
      this.saveError = "";
      if (this.revision === revisionAtStart) this.setSaveState("saved");
      else this.setSaveState("pending");
    } catch (error) {
      if (error?.status === 409) {
        // Another tab saved after this one last saw the file. The edit is
        // still in memory; the user must choose between reloading the newer
        // version and overwriting it, so no timer-based retry happens.
        this.saveError = error.message || "The project changed elsewhere after this tab last saved.";
        this.setSaveState("conflict");
      } else {
        this.saveError = error.message || "Could not save.";
        this.setSaveState("error");
      }
    } finally {
      this.#inFlight = false;
      this.saving = false;
      // A successful save with newer edits should roll forward. A failed save
      // must wait for a real retry (the save indicator, the next edit, or a
      // visibility/unload flush); retrying on a timer would hammer the server
      // and keep the error state from ever being visible.
      if (saved && (this.#pending || this.revision !== this.savedRevision)) {
        window.clearTimeout(this.#timer);
        this.#timer = window.setTimeout(() => this.flush(), SAVE_DELAY);
      }
      const pendingForce = this.#pendingForce;
      this.#pending = false;
      this.#pendingForce = false;
      if (pendingForce && !saved) {
        // A user-requested overwrite arrived while a save was in flight;
        // run it now so the choice is not silently dropped.
        void this.flush({ force: true });
      }
    }
  }

  // Closing the tab, reloading, or navigating away fires pagehide. The normal
  // debounced flush is async and may be torn down before the request leaves
  // the page, which loses the last SAVE_DELAY window of edits even when the
  // user answers the beforeunload prompt with "leave". A keepalive fetch is
  // allowed to finish in the background after the page is gone. Browsers cap
  // keepalive bodies (64 KiB), so oversized projects still rely on the
  // beforeunload warning; nothing is sent when the store is already clean.
  flushOnExit() {
    // A conflicted tab must not force its stale snapshot over newer work while
    // the page unloads. The beforeunload prompt already warned the user.
    if (!this.project || !this.dirty || this.saveState === "conflict") return;
    let body = "";
    try {
      body = JSON.stringify(this.project);
    } catch {
      return; // A document that cannot be serialized was never savable.
    }
    if (!body) return;
    // Compare UTF-8 bytes: string.length counts UTF-16 code units, so a
    // document full of 2–3-byte IPA characters can pass this gate while the
    // request body is already over the keepalive cap.
    if (new TextEncoder().encode(body).byteLength > KEEPALIVE_BYTE_LIMIT) return;
    const headers = { "Content-Type": "application/json" };
    if (this.baseRevision) headers["X-Base-Revision"] = this.baseRevision;
    try {
      void fetch("/api/project", {
        method: "PUT",
        headers,
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Best effort only: the beforeunload warning remains the last resort.
    }
  }

  get dirty() {
    return this.revision !== this.savedRevision;
  }

  // Called when the tab becomes visible again. A clean, idle tab silently
  // reloads a document that changed elsewhere (another tab saved), which is
  // what keeps a stale tab from ever saving over newer work. A dirty tab, a
  // tab mid-save, or a tab with a dialog open is left alone; the next save
  // will hit the 409 path instead.
  //
  // Fetch once and apply that exact snapshot: the old two-GET version could
  // discard an edit made between the staleness check and the reload.
  async resyncIfStale() {
    if (!this.project || this.dirty || this.#inFlight) return;
    if (document.body.classList.contains("has-modal")) return;
    const revisionAtStart = this.revision;
    const baseRevisionAtStart = this.baseRevision;
    let remote;
    try {
      remote = await api.loadProject();
    } catch {
      return;
    }
    const remoteRevision = typeof remote?.updatedAt === "string" ? remote.updatedAt : null;
    if (!remoteRevision || remoteRevision === this.baseRevision) return;
    // A local edit, save, or dialog during the fetch means this tab changed
    // underneath us; leave it alone. The next visibility change tries again.
    if (this.dirty || this.#inFlight || this.revision !== revisionAtStart) return;
    if (this.baseRevision !== baseRevisionAtStart) return;
    if (document.body.classList.contains("has-modal")) return;
    try {
      const applied = await this.load(remote, { ifClean: true });
      if (applied) this.#notifyResync();
    } catch {
      // The next visibility change tries again.
    }
  }

  onResync(listener) {
    this.#resyncListeners.add(listener);
    return () => this.#resyncListeners.delete(listener);
  }

  #notifyResync() {
    for (const listener of this.#resyncListeners) listener();
  }

  setSaveState(state) {
    this.saveState = state;
    for (const listener of this.#statusListeners) listener(state, this.saveError);
  }

  onStatus(listener) {
    this.#statusListeners.add(listener);
    listener(this.saveState, this.saveError);
    return () => this.#statusListeners.delete(listener);
  }

  onHistory(listener) {
    this.#historyListeners.add(listener);
    listener();
    return () => this.#historyListeners.delete(listener);
  }

  #notifyHistory() {
    for (const listener of this.#historyListeners) listener();
  }

  navigate(hash) {
    if (window.location.hash === hash) return;
    window.location.hash = hash;
  }
}

export const store = new ProjectStore();

window.addEventListener("beforeunload", (event) => {
  if (!store.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && store.dirty) store.flush();
  if (document.visibilityState === "visible") void store.resyncIfStale();
});

// visibilitychange covers tab switches, where the page stays alive and the
// async flush can complete. pagehide also fires for closes and reloads, where
// only a keepalive request outlives the page.
window.addEventListener("pagehide", () => store.flushOnExit());
