import { api } from "./api.js";
import { deepClone, ensureProject } from "./model.js";

const SAVE_DELAY = 280;
// Rapid edits (keystrokes in one field, quick consecutive actions) merge into
// a single undo step; a pause longer than this starts a new step.
const HISTORY_COALESCE_MS = 500;
// Snapshots are deep-cloned full documents; keep the stack bounded.
const HISTORY_LIMIT = 100;

class ProjectStore {
  project = null;
  route = { view: "tree" };
  revision = 0;
  savedRevision = 0;
  saving = false;
  saveState = "loading";
  saveError = "";
  // #undoStack holds per-burst pre-edit states to undo into; #redoStack holds
  // states to redo into after an undo. #lastState is the pre-edit state of
  // the burst currently in progress; it becomes the next undo step on the
  // next burst boundary.
  #undoStack = [];
  #redoStack = [];
  #lastState = null;
  #lastTouchAt = 0;
  #recording = false;
  #timer = null;
  #inFlight = false;
  #pending = false;
  #statusListeners = new Set();
  #historyListeners = new Set();

  async load() {
    const raw = await api.loadProject();
    const before = JSON.stringify(raw);
    this.project = ensureProject(raw);
    const after = JSON.stringify(this.project);
    this.revision = 0;
    this.savedRevision = 0;
    this.#undoStack = [];
    this.#redoStack = [];
    this.#lastState = deepClone(this.project);
    this.setSaveState("saved");
    if (before !== after || !raw.languages?.length) {
      this.touch({ immediate: true });
    }
    // History starts only after loading: the loader's normalizing save is not
    // an edit the user made, so nothing should be undoable past this point.
    this.#lastState = deepClone(this.project);
    this.#lastTouchAt = 0;
    this.#recording = true;
    this.#notifyHistory();
    return this.project;
  }

  touch(options = {}) {
    if (!this.project) return;
    this.revision += 1;
    this.project.updatedAt = new Date().toISOString();
    if (this.#recording) this.#recordHistory();
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
  #recordHistory() {
    const now = Date.now();
    const coalesce = this.#undoStack.length > 0 && now - this.#lastTouchAt <= HISTORY_COALESCE_MS;
    if (!coalesce) {
      this.#undoStack.push({ document: this.#lastState, time: now });
      if (this.#undoStack.length > HISTORY_LIMIT) this.#undoStack.shift();
      this.#redoStack = [];
    }
    this.#lastTouchAt = now;
    this.#lastState = deepClone(this.project);
    this.#notifyHistory();
  }

  canUndo() {
    return this.#undoStack.length > 0;
  }

  canRedo() {
    return this.#redoStack.length > 0;
  }

  undo() {
    if (!this.project || !this.#undoStack.length) return false;
    const entry = this.#undoStack.pop();
    this.#redoStack.push({ document: deepClone(this.project), time: Date.now() });
    this.#applyHistory(entry.document);
    return true;
  }

  redo() {
    if (!this.project || !this.#redoStack.length) return false;
    const entry = this.#redoStack.pop();
    this.#undoStack.push({ document: deepClone(this.project), time: Date.now() });
    if (this.#undoStack.length > HISTORY_LIMIT) this.#undoStack.shift();
    this.#applyHistory(entry.document);
    return true;
  }

  // Restoring a snapshot is a document change like any other: it marks the
  // store dirty so the reverted state is written back to the project file,
  // but it never adds another history step of its own.
  #applyHistory(document) {
    this.project = deepClone(document);
    this.#lastState = deepClone(this.project);
    this.#lastTouchAt = 0;
    this.revision += 1;
    this.project.updatedAt = new Date().toISOString();
    this.setSaveState(this.#inFlight ? "saving" : "pending");
    window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => this.flush(), SAVE_DELAY);
    this.#notifyHistory();
  }

  async flush() {
    window.clearTimeout(this.#timer);
    if (!this.project) return;
    if (this.#inFlight) {
      this.#pending = true;
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
      const result = await api.saveProject(snapshot);
      saved = true;
      this.savedRevision = revisionAtStart;
      // Adopt the server's stamp so the in-memory document matches what was
      // actually written (the server is the authority on save time).
      if (result?.savedAt) this.project.updatedAt = result.savedAt;
      this.saveError = "";
      if (this.revision === revisionAtStart) this.setSaveState("saved");
      else this.setSaveState("pending");
    } catch (error) {
      this.saveError = error.message || "Could not save.";
      this.setSaveState("error");
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
      this.#pending = false;
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
    if (!this.project || !this.dirty) return;
    let body = "";
    try {
      body = JSON.stringify(this.project);
    } catch {
      return; // A document that cannot be serialized was never savable.
    }
    if (!body || body.length > 60000) return;
    try {
      void fetch("/api/project", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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
});

// visibilitychange covers tab switches, where the page stays alive and the
// async flush can complete. pagehide also fires for closes and reloads, where
// only a keepalive request outlives the page.
window.addEventListener("pagehide", () => store.flushOnExit());
