import { api } from "./api.js";
import { ensureProject } from "./model.js";

const SAVE_DELAY = 280;

class ProjectStore {
  project = null;
  route = { view: "tree" };
  revision = 0;
  savedRevision = 0;
  saving = false;
  saveState = "loading";
  saveError = "";
  #timer = null;
  #inFlight = false;
  #pending = false;
  #statusListeners = new Set();

  async load() {
    const raw = await api.loadProject();
    const before = JSON.stringify(raw);
    this.project = ensureProject(raw);
    const after = JSON.stringify(this.project);
    this.revision = 0;
    this.savedRevision = 0;
    this.setSaveState("saved");
    if (before !== after || !raw.languages?.length) {
      this.touch({ immediate: true });
    }
    return this.project;
  }

  touch(options = {}) {
    if (!this.project) return;
    this.revision += 1;
    this.project.updatedAt = new Date().toISOString();
    this.setSaveState(this.#inFlight ? "saving" : "pending");
    if (options.immediate) {
      this.flush();
      return;
    }
    window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => this.flush(), SAVE_DELAY);
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
    try {
      const result = await api.saveProject(snapshot);
      this.savedRevision = revisionAtStart;
      if (result?.savedAt) this.project.updatedAt = snapshot.updatedAt;
      this.saveError = "";
      if (this.revision === revisionAtStart) this.setSaveState("saved");
      else this.setSaveState("pending");
    } catch (error) {
      this.saveError = error.message || "Could not save.";
      this.setSaveState("error");
    } finally {
      this.#inFlight = false;
      this.saving = false;
      if (this.#pending || this.revision !== this.savedRevision) {
        this.#pending = false;
        window.clearTimeout(this.#timer);
        this.#timer = window.setTimeout(() => this.flush(), SAVE_DELAY);
      }
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
