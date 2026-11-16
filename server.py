#!/usr/bin/env python3
"""Local web server for Language Tree.

Serves the static frontend and a tiny JSON-file API. No third-party
dependencies are required. Every project is a JSON file in data/; the active
file is remembered in data/.active-project so the app reopens the same project
on the next run.
"""

from __future__ import annotations

import argparse
import errno
import http.client
import json
import os
import re
import sys
import tempfile
import threading
import time
import webbrowser
import zlib
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
DATA_DIR = ROOT / "data"
ACTIVE_FILE = DATA_DIR / ".active-project"
SEED_PROJECT_NAME = "example_project.json"
DEFAULT_PROJECT_TITLE = "Untitled language family"

MAX_BODY_BYTES = 12 * 1024 * 1024  # Compressed bytes on the wire.
MAX_JSON_BYTES = 128 * 1024 * 1024  # Decompressed JSON limit.
SAVE_LOCK = threading.Lock()

# Snapshots live beside the projects they protect, never in the project list.
# A save copies the current file first, but only when the newest snapshot is
# old enough: autosave fires every few hundred milliseconds, and rewriting a
# large project on every keystroke would be wasteful. Restores always snapshot.
BACKUP_DIR = DATA_DIR / ".backups"
SNAPSHOT_INTERVAL_SECONDS = 10 * 60
SNAPSHOT_KEEP = 20
SNAPSHOT_NAME_PATTERN = re.compile(r"\d{8}T\d{12}Z\.json\Z")

# A browser always sends a Host header. When the server is bound to loopback,
# any other Host means the request was routed here by something other than
# typing the local address — the classic DNS-rebinding setup, where a remote
# page's domain resolves to 127.0.0.1 and reads the API same-origin. Requests
# with an unexpected Host are refused before any data is served. Custom
# --host values (0.0.0.0, a LAN address) opt out: those deployments serve
# other machines by design and are documented as trusted-network-only.
LOOPBACK_BINDS = {"127.0.0.1", "localhost", "::1"}
LOOPBACK_HOSTS = LOOPBACK_BINDS | {""}  # empty Host = HTTP/1.0 client


def host_name_of(headers) -> str:
    host = (headers.get("Host") or "").strip().lower()
    if host.startswith("["):  # IPv6 literal, e.g. [::1]:8765
        return host[1:].split("]")[0]
    # Only a well-formed host:port has a host part before a single colon. An
    # unbracketed IPv6 literal (::1) or a leading colon (:evil.example) would
    # otherwise normalize to the empty host, which is allowlisted for HTTP/1.0.
    if host.startswith(":") or host.count(":") > 1:
        return host
    return host.split(":")[0]  # drop the port


def url_for_host(host: str, port: int) -> str:
    """A URL a browser can open; IPv6 literals need brackets in URLs."""
    host = host.strip()
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    return f"http://{host}:{port}/"


def utc_now() -> str:
    # updatedAt doubles as the optimistic-concurrency revision, so two saves in
    # the same second must not share a stamp. Microseconds keep the value
    # human-readable and backward-compatible with existing project files.
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def project_names() -> list[str]:
    """Every direct *.json child of data/ is a project, valid or not."""
    if not DATA_DIR.is_dir():
        return []
    return sorted(
        (
            entry.name
            for entry in DATA_DIR.iterdir()
            # A link is listed but cannot be opened through its link name
            # (project_path rejects the resolved name), so hide it instead.
            if entry.is_file() and not entry.is_symlink() and entry.suffix.lower() == ".json"
        ),
        key=str.casefold,
    )


def project_path(name: object) -> Path:
    """Resolve a project filename, refusing paths outside data/."""
    if not isinstance(name, str) or not name or "\x00" in name:
        raise InvalidProjectRequest("A project file name is required.")
    if "/" in name or "\\" in name or name in (".", ".."):
        raise InvalidProjectRequest("Project files must live directly in data/.")
    if not name.lower().endswith(".json"):
        raise InvalidProjectRequest("Project files must use a .json extension.")
    path = (DATA_DIR / name).resolve()
    if path.parent != DATA_DIR.resolve() or path.name != name:
        raise InvalidProjectRequest("Project files must live directly in data/.")
    return path


# New project names must be portable. Windows reads ":" as an NTFS alternate
# data stream and treats device names such as CON or AUX as devices even when
# they carry an extension. Existing files with such names can still be opened;
# this validation only governs names this server creates.
PORTABLE_NAME_FORBIDDEN = set('<>:"|?*')
WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "CLOCK$",
    "CONIN$",
    "CONOUT$",
    *(f"COM{number}" for number in range(1, 10)),
    *(f"LPT{number}" for number in range(1, 10)),
}


def validate_new_project_name(name: object) -> None:
    """Refuse a new project name that is not portable to Windows."""
    if not isinstance(name, str) or not name or "\x00" in name:
        raise InvalidProjectRequest("A project file name is required.")
    if "/" in name or "\\" in name:
        raise InvalidProjectRequest("Project files must live directly in data/.")
    if not name.lower().endswith(".json"):
        raise InvalidProjectRequest("Project files must use a .json extension.")
    if any(char in PORTABLE_NAME_FORBIDDEN or ord(char) < 32 for char in name):
        raise InvalidProjectRequest(
            'Project file names cannot contain < > : " | ? * or control characters.'
        )
    base = name[:-5].strip()
    if not base:
        raise InvalidProjectRequest("Project files need a name before .json.")
    device = base.split(".", 1)[0].strip().upper()
    if device in WINDOWS_RESERVED_NAMES:
        raise InvalidProjectRequest(
            f"{device} is reserved by Windows; choose another file name."
        )


def read_project_file(name: str) -> dict:
    path = project_path(name)
    # Opening a FIFO or a directory can block forever while SAVE_LOCK is held;
    # only regular files are projects.
    if not path.is_file():
        raise FileNotFoundError("Project file not found.")
    with path.open("r", encoding="utf-8") as handle:
        project = json.load(handle)
    validate_project(project)
    return project


def fsync_directory(directory: Path) -> None:
    """Persist a rename on POSIX; Windows has no directory fsync."""
    if os.name == "nt":
        return
    try:
        descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        # Some filesystems reject directory fsync; the file itself is synced.
        pass
    finally:
        os.close(descriptor)


def replace_with_retry(source: Path, destination: Path) -> None:
    """Replace a file, retrying transient Windows sharing violations.

    Two server processes can save the same project at once. Windows refuses
    os.replace() while the other process is renaming onto the destination, so
    retry briefly instead of turning a valid save into a 500.
    """
    attempts = 20 if os.name == "nt" else 1
    delay = 0.005
    for attempt in range(attempts):
        try:
            os.replace(source, destination)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 0.1)


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write bytes through a unique temporary file, then rename it into place."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        replace_with_retry(temporary, path)
    except BaseException:
        try:
            temporary.unlink()
        except OSError:
            pass
        raise
    fsync_directory(path.parent)


def atomic_write_text(path: Path, text: str) -> None:
    """Write UTF-8 text atomically with LF line endings."""
    atomic_write_bytes(path, text.encode("utf-8"))


def write_project(project: dict, name: str) -> None:
    """Write pretty JSON atomically, preserving a single-file git workflow."""
    path = project_path(name)
    text = json.dumps(project, ensure_ascii=False, indent=2) + "\n"
    atomic_write_text(path, text)


def snapshot_directory(name: str) -> Path:
    """The backup folder for one project, always directly under .backups/."""
    directory = (BACKUP_DIR / name).resolve()
    if directory.parent != BACKUP_DIR.resolve():
        raise InvalidProjectRequest("Invalid snapshot location.")
    return directory


def snapshot_path(name: str, snapshot: object) -> Path:
    """Resolve a snapshot filename, refusing traversal and unknown shapes."""
    if not isinstance(snapshot, str) or not SNAPSHOT_NAME_PATTERN.fullmatch(snapshot):
        raise InvalidProjectRequest("Invalid snapshot name.")
    directory = snapshot_directory(name)
    path = directory / snapshot
    # Check the directory entry before resolving: Path.resolve() follows
    # symlinks, so a same-directory link would otherwise be read as its target.
    if path.is_symlink():
        raise FileNotFoundError("Snapshot not found.")
    if path.resolve().parent != directory:
        raise InvalidProjectRequest("Invalid snapshot name.")
    return path


def snapshot_metadata(path: Path) -> dict:
    stat = path.stat()
    saved_at = datetime.fromtimestamp(stat.st_mtime, timezone.utc)
    return {
        "name": path.name,
        "size": stat.st_size,
        "savedAt": saved_at.isoformat(timespec="seconds").replace("+00:00", "Z"),
    }


def list_snapshots(name: str) -> list[dict]:
    """Newest first. Broken and symlinked snapshots are never offered."""
    directory = snapshot_directory(name)
    if not directory.is_dir():
        return []
    snapshots = []
    for entry in directory.iterdir():
        if not SNAPSHOT_NAME_PATTERN.fullmatch(entry.name):
            continue
        if entry.is_symlink() or not entry.is_file():
            continue
        try:
            snapshots.append(snapshot_metadata(entry))
        except OSError:
            continue
    snapshots = [item for item in snapshots if item["size"] > 0]
    snapshots.sort(key=lambda item: item["name"], reverse=True)
    return snapshots


def read_snapshot(name: str, snapshot: str) -> dict:
    path = snapshot_path(name, snapshot)
    if not path.is_file() or path.stat().st_size == 0:
        raise FileNotFoundError("Snapshot not found.")
    with path.open("r", encoding="utf-8") as handle:
        project = json.load(handle)
    validate_project(project)
    return project


def prune_snapshots(directory: Path) -> None:
    """Keep the newest SNAPSHOT_KEEP snapshots; ignore files we do not own."""
    entries = sorted(
        (
            entry
            for entry in directory.iterdir()
            if SNAPSHOT_NAME_PATTERN.fullmatch(entry.name)
            and not entry.is_symlink()
            and entry.is_file()
        ),
        key=lambda entry: entry.name,
    )
    for entry in entries[:-SNAPSHOT_KEEP]:
        try:
            entry.unlink()
        except OSError:
            # A snapshot that cannot be removed is still only a backup file;
            # never turn cleanup into a failed save.
            pass


def create_snapshot(name: str, force: bool = False) -> str:
    """Copy the current project into .backups/ before it is overwritten.

    Returns the snapshot filename, or an empty string when the newest snapshot
    is still inside the interval. Raises OSError when the copy cannot be made;
    save callers turn that into a warning, while restore refuses to proceed.
    """
    source = project_path(name)
    if not source.is_file():
        return ""
    directory = snapshot_directory(name)
    if directory.exists() and not directory.is_dir():
        raise OSError("The snapshot location is not a directory.")
    if not force and directory.is_dir():
        newest = 0.0
        for entry in directory.iterdir():
            if not SNAPSHOT_NAME_PATTERN.fullmatch(entry.name):
                continue
            if entry.is_symlink() or not entry.is_file():
                continue
            try:
                stat = entry.stat()
            except OSError:
                continue
            # A zero-byte file from an interrupted write is not a snapshot and
            # must not suppress the next backup for a whole interval.
            if stat.st_size == 0:
                continue
            newest = max(newest, stat.st_mtime)
        if newest and time.time() - newest < SNAPSHOT_INTERVAL_SECONDS:
            return ""

    directory.mkdir(parents=True, exist_ok=True)
    while True:
        target = directory / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ.json")
        try:
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o666)
        except FileExistsError:
            time.sleep(0.001)
            continue
        os.close(descriptor)
        break
    try:
        atomic_write_bytes(target, source.read_bytes())
    except BaseException:
        try:
            target.unlink()
        except OSError:
            pass
        raise
    prune_snapshots(directory)
    return target.name


def read_active_name() -> str | None:
    try:
        name = ACTIVE_FILE.read_text(encoding="utf-8-sig").strip()
    except OSError:
        return None
    return name or None


def write_active_name(name: str) -> None:
    project_path(name)  # Refuse anything that is not a plain project filename.
    atomic_write_text(ACTIVE_FILE, f"{name}\n")


def resolve_active_name() -> str | None:
    """The remembered file when it still exists, otherwise a stable fallback."""
    names = project_names()
    remembered = read_active_name()
    if remembered in names:
        return remembered
    return names[0] if names else None


def requested_project_name(query: str) -> str | None:
    """Read the optional ?file= selector shared by GET and PUT /api/project."""
    values = parse_qs(query, keep_blank_values=True).get("file")
    if values is None:
        return None
    if len(values) != 1 or not values[0].strip():
        raise InvalidProjectRequest("Specify exactly one project file.")
    return values[0].strip()


def requested_snapshot_name(query: str) -> str | None:
    """Read the optional ?name= selector for a single snapshot."""
    values = parse_qs(query, keep_blank_values=True).get("name")
    if values is None:
        return None
    if len(values) != 1 or not values[0].strip():
        raise InvalidProjectRequest("Specify exactly one snapshot.")
    return values[0].strip()


class BodyTooLargeError(ValueError):
    """The decompressed request body exceeds MAX_JSON_BYTES."""


class InvalidProjectRequest(ValueError):
    """A project filename or selector is not acceptable."""


def gunzip_limited(data: bytes, limit: int) -> bytes:
    """Decompress a gzip request body, refusing output larger than `limit`.

    Streaming with max_length means an oversized body is cut off at `limit`
    bytes of output instead of being expanded into memory first.
    """
    decomp = zlib.decompressobj(wbits=31)  # 31 = gzip container + deflate
    out = decomp.decompress(data, limit + 1)
    if len(out) > limit or decomp.unconsumed_tail:
        raise BodyTooLargeError("The decompressed project is too large.")
    tail = decomp.flush()
    if len(out) + len(tail) > limit:
        raise BodyTooLargeError("The decompressed project is too large.")
    if not decomp.eof:
        raise ValueError("Truncated gzip request body.")
    return out + tail


def validate_project(project: object) -> None:
    if not isinstance(project, dict):
        raise ValueError("The project must be a JSON object.")
    if not isinstance(project.get("languages"), list):
        raise ValueError("The project must contain a languages array.")
    if not isinstance(project.get("title"), str):
        raise ValueError("The project must contain a title string.")
    if len(project["languages"]) > 5000:
        raise ValueError("The project contains too many languages.")
    for item in project["languages"]:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            raise ValueError("Every language needs a string id.")
        if not isinstance(item.get("name"), str):
            raise ValueError("Every language needs a name.")


def blank_project(title: str) -> dict:
    """A brand-new project starts empty; languages are added in the app."""
    now = utc_now()
    return {
        "version": 1,
        "title": title,
        "createdAt": now,
        "updatedAt": now,
        "languages": [],
    }


def project_summary(name: str) -> dict:
    """List metadata, keeping a broken file visible instead of hiding it."""
    summary: dict = {"file": name}
    try:
        project = read_project_file(name)
    except OSError:
        summary["error"] = "Could not read the project file."
        return summary
    except ValueError as exc:
        summary["error"] = str(exc)
        return summary
    summary["title"] = project["title"]
    summary["languages"] = len(project["languages"])
    updated_at = project.get("updatedAt")
    if isinstance(updated_at, str) and updated_at:
        summary["updatedAt"] = updated_at
    return summary


class LanguageTreeHandler(SimpleHTTPRequestHandler):
    server_version = "LanguageTree/0.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def host_allowed(self) -> bool:
        """False means a response was already sent; the caller should return."""
        allowed = getattr(self.server, "allowed_hosts", None)
        if allowed is None:
            return True
        host = host_name_of(self.headers)
        if host in allowed:
            return True
        self.log_error("Unexpected Host header %r from %s", host, self.client_address[0])
        self.send_json({"error": "Unexpected Host header."}, HTTPStatus.FORBIDDEN)
        return False

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        # The app is local-only; a remote page must not frame loopback and
        # clickjack destructive confirmations.
        self.send_header("X-Frame-Options", "DENY")
        # Scripts are external modules only. Inline style attributes remain in
        # the rendered markup, so styles need the inline allowance for now.
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; "
            "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        )
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def send_json(self, payload: object, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        # A HEAD response carries the GET headers, including Content-Length,
        # but no body; writing one makes strict clients treat it as garbage
        # after the response.
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self) -> None:  # noqa: N802 (stdlib naming)
        if not self.host_allowed():
            return
        super().do_HEAD()

    def do_GET(self) -> None:  # noqa: N802 (stdlib naming)
        if not self.host_allowed():
            return
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"ok": True, "time": utc_now()})
            return
        if path == "/api/projects":
            with SAVE_LOCK:
                names = project_names()
                active = resolve_active_name()
                projects = [project_summary(name) for name in names]
            self.send_json({"active": active, "projects": projects})
            return
        if path == "/api/project":
            name: str | None = None
            try:
                name = requested_project_name(urlparse(self.path).query)
                if name is None:
                    name = resolve_active_name()
                if name is None:
                    self.send_json({"error": "No project files in data/."}, HTTPStatus.NOT_FOUND)
                    return
                # Windows cannot replace a project file while another thread
                # has it open, so reads share the writer's lock instead of
                # racing os.replace() and turning a valid save into a 500.
                with SAVE_LOCK:
                    project = read_project_file(name)
            except FileNotFoundError:
                self.send_json({"error": "Project file not found."}, HTTPStatus.NOT_FOUND)
                return
            except InvalidProjectRequest as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except ValueError as exc:
                self.send_json(
                    {"error": f"Project file is not valid: {exc}"},
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )
                return
            except OSError as exc:
                self.log_error("Could not read project %r: %s", name, exc)
                self.send_json(
                    {"error": "Could not read the project file."},
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )
                return
            self.send_json(project)
            return
        if path == "/api/snapshots":
            name: str | None = None
            snapshot: str | None = None
            try:
                query = urlparse(self.path).query
                name = requested_project_name(query)
                if name is None:
                    name = resolve_active_name()
                if name is None:
                    self.send_json({"error": "No project files in data/."}, HTTPStatus.NOT_FOUND)
                    return
                if not project_path(name).is_file():
                    self.send_json({"error": "Project file not found."}, HTTPStatus.NOT_FOUND)
                    return
                snapshot = requested_snapshot_name(query)
                with SAVE_LOCK:
                    if snapshot is not None:
                        project = read_snapshot(name, snapshot)
                    else:
                        snapshots = list_snapshots(name)
            except FileNotFoundError:
                self.send_json({"error": "Snapshot not found."}, HTTPStatus.NOT_FOUND)
                return
            except InvalidProjectRequest as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            except ValueError as exc:
                self.send_json(
                    {"error": f"Snapshot is not a valid project: {exc}"},
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )
                return
            except OSError as exc:
                self.log_error("Could not read snapshots for %r: %s", name, exc)
                self.send_json(
                    {"error": "Could not read the backup snapshots."},
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )
                return
            if snapshot is not None:
                self.send_json(project)
            else:
                self.send_json(
                    {
                        "file": name,
                        "snapshots": snapshots,
                        "keep": SNAPSHOT_KEEP,
                        "intervalSeconds": SNAPSHOT_INTERVAL_SECONDS,
                    }
                )
            return
        if path.startswith("/api/"):
            self.send_json({"error": "Unknown API endpoint."}, HTTPStatus.NOT_FOUND)
            return
        super().do_GET()

    def read_json_body(self) -> tuple[bool, object]:
        """Read a JSON request body, sending the error response on failure."""
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json({"error": "Invalid Content-Length."}, HTTPStatus.BAD_REQUEST)
            return False, None
        if length <= 0:
            self.send_json({"error": "Request body is required."}, HTTPStatus.BAD_REQUEST)
            return False, None
        if length > MAX_BODY_BYTES:
            self.send_json({"error": "Request body is too large."}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            return False, None

        encoding = (self.headers.get("Content-Encoding") or "").strip().lower()
        if encoding not in ("", "identity", "gzip"):
            self.send_json(
                {"error": f"Unsupported Content-Encoding: {encoding}."},
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
            )
            return False, None

        try:
            raw = self.rfile.read(length)
            if encoding == "gzip":
                raw = gunzip_limited(raw, MAX_JSON_BYTES)
            return True, json.loads(raw.decode("utf-8"))
        except BodyTooLargeError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self.send_json({"error": f"Invalid JSON: {exc}"}, HTTPStatus.BAD_REQUEST)
        except RecursionError:
            self.send_json(
                {"error": "Invalid JSON: the document is nested too deeply."},
                HTTPStatus.BAD_REQUEST,
            )
        except (zlib.error, ValueError) as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        return False, None

    def put_project(self) -> None:
        try:
            name = requested_project_name(urlparse(self.path).query)
            if name is None:
                name = resolve_active_name()
            if name is None:
                self.send_json({"error": "No project files in data/."}, HTTPStatus.NOT_FOUND)
                return
            path = project_path(name)
        except InvalidProjectRequest as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if not path.is_file():
            self.send_json({"error": "Project file not found."}, HTTPStatus.NOT_FOUND)
            return

        ok, project = self.read_json_body()
        if not ok:
            return
        try:
            validate_project(project)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        # The client may send the updatedAt stamp of the document it last saw
        # (X-Base-Revision). A mismatch means another tab or window saved in
        # the meantime: without this check the stale tab's whole-file PUT
        # would silently overwrite the newer work (last-write-wins). Answer
        # 409 and let the client offer reload or overwrite. Requests without
        # the header (older clients, force-saves) keep the old behavior.
        base_revision = (self.headers.get("X-Base-Revision") or "").strip()
        snapshot_warning = ""
        try:
            with SAVE_LOCK:
                if base_revision:
                    try:
                        current = read_project_file(name)
                    except (OSError, ValueError):
                        current = None
                    current_revision = str(current.get("updatedAt") or "") if isinstance(current, dict) else ""
                    if current_revision != base_revision:
                        self.send_json(
                            {
                                "error": "The project was saved by another tab or window after this one last saved. Reload the newer version, or save again to overwrite it.",
                                "currentRevision": current_revision,
                            },
                            HTTPStatus.CONFLICT,
                        )
                        return
                # A backup must never turn a valid save into a failed one:
                # report the problem alongside the successful save instead.
                try:
                    create_snapshot(name)
                except Exception as exc:  # noqa: BLE001 (backup is best-effort)
                    self.log_error("Could not snapshot project %r: %s", name, exc)
                    snapshot_warning = (
                        "The project was saved, but a backup snapshot could not be created. "
                        "Check that data/.backups/ is writable."
                    )
                # Stamp only after the revision check, under the same lock as
                # the write, so concurrent force-saves cannot share a stamp.
                project["updatedAt"] = utc_now()
                write_project(project, name)
        except OSError as exc:
            self.log_error("Could not save project %r: %s", name, exc)
            self.send_json(
                {"error": "Could not save the project file."},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        response = {"ok": True, "savedAt": project["updatedAt"], "file": name}
        if snapshot_warning:
            response["snapshotWarning"] = snapshot_warning
        self.send_json(response)

    def post_restore_snapshot(self) -> None:
        ok, payload = self.read_json_body()
        if not ok:
            return
        if (
            not isinstance(payload, dict)
            or not isinstance(payload.get("file"), str)
            or not isinstance(payload.get("name"), str)
        ):
            self.send_json(
                {"error": "The request must name a project file and a snapshot."},
                HTTPStatus.BAD_REQUEST,
            )
            return
        name = payload["file"]
        snapshot = payload["name"]
        try:
            path = project_path(name)
        except InvalidProjectRequest as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if not path.is_file():
            self.send_json({"error": "Project file not found."}, HTTPStatus.NOT_FOUND)
            return

        base_revision = (self.headers.get("X-Base-Revision") or "").strip()
        try:
            with SAVE_LOCK:
                if base_revision:
                    try:
                        current = read_project_file(name)
                    except (OSError, ValueError):
                        current = None
                    current_revision = str(current.get("updatedAt") or "") if isinstance(current, dict) else ""
                    if current_revision != base_revision:
                        self.send_json(
                            {
                                "error": "The project was saved by another tab or window after this one last saved. Reload the newer version, then restore the snapshot again.",
                                "currentRevision": current_revision,
                            },
                            HTTPStatus.CONFLICT,
                        )
                        return
                try:
                    restored = read_snapshot(name, snapshot)
                except FileNotFoundError:
                    self.send_json({"error": "Snapshot not found."}, HTTPStatus.NOT_FOUND)
                    return
                except InvalidProjectRequest as exc:
                    self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                    return
                except ValueError as exc:
                    self.send_json(
                        {"error": f"Snapshot is not a valid project: {exc}"},
                        HTTPStatus.INTERNAL_SERVER_ERROR,
                    )
                    return
                # Restoring overwrites the live file, so take a forced snapshot
                # first even when one was taken moments ago. If that backup
                # fails, refuse the restore instead of destroying the only copy.
                try:
                    previous = create_snapshot(name, force=True)
                except Exception as exc:  # noqa: BLE001 (keep the restore recoverable)
                    self.log_error("Could not snapshot project %r before restore: %s", name, exc)
                    self.send_json(
                        {"error": "Could not back up the current project before restoring. The project was not changed."},
                        HTTPStatus.INTERNAL_SERVER_ERROR,
                    )
                    return
                # Bump the revision so other tabs holding the old updatedAt
                # see a conflict instead of silently saving stale work later.
                restored["updatedAt"] = utc_now()
                write_project(restored, name)
        except InvalidProjectRequest as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        except OSError as exc:
            self.log_error("Could not restore project %r: %s", name, exc)
            self.send_json(
                {"error": "Could not restore the project file."},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        self.send_json(
            {
                "ok": True,
                "file": name,
                "savedAt": restored["updatedAt"],
                "project": restored,
                "snapshot": previous,
            }
        )

    def post_project(self) -> None:
        ok, payload = self.read_json_body()
        if not ok:
            return
        if not isinstance(payload, dict):
            self.send_json(
                {"error": "The request must be a JSON object with a file name and title."},
                HTTPStatus.BAD_REQUEST,
            )
            return
        title = payload.get("title", "")
        if not isinstance(title, str):
            self.send_json({"error": "The project title must be a string."}, HTTPStatus.BAD_REQUEST)
            return
        title = title.strip() or DEFAULT_PROJECT_TITLE
        name = payload.get("file")
        try:
            # Validate before reserving the name: on Windows some names (":"
            # streams, reserved devices) fail only after the base file exists.
            validate_new_project_name(name)
            path = project_path(name)
        except InvalidProjectRequest as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        try:
            with SAVE_LOCK:
                if os.path.lexists(path):
                    self.send_json(
                        {"error": f"A project file named {name} already exists."},
                        HTTPStatus.CONFLICT,
                    )
                    return
                try:
                    # Reserve the name before writing so a second server process
                    # cannot create the same project between the check and the
                    # write. The reserved empty file is replaced atomically below.
                    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o666)
                except FileExistsError:
                    self.send_json(
                        {"error": f"A project file named {name} already exists."},
                        HTTPStatus.CONFLICT,
                    )
                    return
                try:
                    os.close(descriptor)
                    project = blank_project(title)
                    write_project(project, name)
                    write_active_name(name)
                except BaseException:
                    # A failed creation must not leave a broken file behind.
                    try:
                        path.unlink()
                    except OSError:
                        pass
                    raise
        except OSError as exc:
            self.log_error("Could not create project %r: %s", name, exc)
            self.send_json(
                {"error": "Could not create the project file."},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        self.send_json({"ok": True, "file": name, "project": project}, HTTPStatus.CREATED)

    def put_active_project(self) -> None:
        ok, payload = self.read_json_body()
        if not ok:
            return
        if not isinstance(payload, dict) or not isinstance(payload.get("file"), str):
            self.send_json({"error": "The request must name a project file."}, HTTPStatus.BAD_REQUEST)
            return
        name = payload["file"]
        try:
            path = project_path(name)
        except InvalidProjectRequest as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if not path.is_file():
            self.send_json({"error": "Project file not found."}, HTTPStatus.NOT_FOUND)
            return
        try:
            with SAVE_LOCK:
                # Refuse to activate a file the app cannot load; otherwise the
                # next page open would strand the user on a broken document.
                read_project_file(name)
                write_active_name(name)
        except FileNotFoundError:
            self.send_json({"error": "Project file not found."}, HTTPStatus.NOT_FOUND)
            return
        except ValueError as exc:
            self.send_json({"error": f"Project file is not valid: {exc}"}, HTTPStatus.BAD_REQUEST)
            return
        except OSError as exc:
            self.log_error("Could not switch to project %r: %s", name, exc)
            self.send_json(
                {"error": "Could not switch the project file."},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        self.send_json({"ok": True, "active": name})

    def do_PUT(self) -> None:  # noqa: N802 (stdlib naming)
        if not self.host_allowed():
            return
        path = urlparse(self.path).path
        if path == "/api/project":
            self.put_project()
            return
        if path == "/api/projects/active":
            self.put_active_project()
            return
        self.send_json({"error": "Unknown API endpoint."}, HTTPStatus.NOT_FOUND)

    def method_not_allowed(self) -> None:
        # SimpleHTTPRequestHandler implements only GET/HEAD, so any other
        # method without a do_* handler gets the stdlib's HTML 501 page. Keep
        # every API method on the same JSON envelope instead.
        if not self.host_allowed():
            return
        self.send_json(
            {"error": "Method not allowed. Save the project with PUT /api/project."},
            HTTPStatus.METHOD_NOT_ALLOWED,
        )

    def do_POST(self) -> None:  # noqa: N802 (stdlib naming)
        if not self.host_allowed():
            return
        path = urlparse(self.path).path
        if path == "/api/projects":
            self.post_project()
            return
        if path == "/api/snapshots/restore":
            self.post_restore_snapshot()
            return
        self.method_not_allowed()

    def do_DELETE(self) -> None:  # noqa: N802 (stdlib naming)
        self.method_not_allowed()

    def do_OPTIONS(self) -> None:  # noqa: N802 (stdlib naming)
        self.method_not_allowed()

    def do_PATCH(self) -> None:  # noqa: N802 (stdlib naming)
        self.method_not_allowed()

    def do_TRACE(self) -> None:  # noqa: N802 (stdlib naming)
        self.method_not_allowed()

    def do_CONNECT(self) -> None:  # noqa: N802 (stdlib naming)
        self.method_not_allowed()


class LanguageTreeHTTPServer(ThreadingHTTPServer):
    """HTTP server that refuses to share its port with another instance."""

    # Python enables SO_REUSEADDR by default. On Windows that lets a second
    # process bind a port that is already listening, and the two servers then
    # split incoming requests unpredictably. Dropping the reusable bind on
    # Windows makes the second launch fail instead of serving half-broken pages.
    allow_reuse_address = os.name != "nt"

    # A browser opens several connections at once. The stdlib default of 5 is
    # short enough that Windows can refuse the overflow before accept() runs.
    request_queue_size = 32


def running_instance(host: str, port: int) -> bool:
    """True when an existing Language Tree server already answers on host:port."""
    connection = http.client.HTTPConnection(host, port, timeout=1.5)
    try:
        connection.request("GET", "/api/health")
        response = connection.getresponse()
        if response.status != HTTPStatus.OK:
            return False
        payload = json.loads(response.read(64 * 1024).decode("utf-8"))
    except (OSError, ValueError, http.client.HTTPException):
        return False
    finally:
        connection.close()
    return isinstance(payload, dict) and payload.get("ok") is True


def ensure_data_files() -> None:
    """Create a first project and keep the active-project pointer usable."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not project_names():
        write_project(blank_project("Example language family"), SEED_PROJECT_NAME)
    active = resolve_active_name()
    if active is not None and read_active_name() != active:
        write_active_name(active)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Language Tree web UI.")
    parser.add_argument("--host", default="127.0.0.1", help="Interface to bind (default: 127.0.0.1). Loopback binds refuse requests whose Host header names another machine.")
    parser.add_argument("--port", type=int, default=8765, help="Port to use (default: 8765)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser automatically")
    args = parser.parse_args()

    host = args.host.strip()
    if args.port and host.lower() in LOOPBACK_BINDS:
        url = url_for_host(host, args.port)
        if running_instance(host, args.port):
            # A repeat launch (common when start.bat is double-clicked again)
            # should reach the app, not create a second server that competes
            # with the first for requests on the same port.
            print()
            print("  Language Tree is already running.")
            print(f"  {url}")
            print("  Stop the existing server first to restart it.")
            print()
            if not args.no_browser:
                webbrowser.open(url)
            return

    ensure_data_files()
    active = resolve_active_name()
    try:
        server = LanguageTreeHTTPServer((host, args.port), LanguageTreeHandler)
    except OSError as exc:
        if exc.errno != errno.EADDRINUSE:
            raise
        print(file=sys.stderr)
        print(f"  Cannot start: {host}:{args.port} is already in use.", file=sys.stderr)
        print("  Another program, or a stale Language Tree server, owns this port.", file=sys.stderr)
        print("  Close it, or start on another port:", file=sys.stderr)
        print("    python server.py --port 9000", file=sys.stderr)
        print(f"  On Windows, find the owner with: netstat -ano | findstr :{args.port}", file=sys.stderr)
        print(file=sys.stderr)
        raise SystemExit(1) from exc
    # Loopback binds serve this machine only, so the Host header must say so
    # too; any other name is treated as a rebinding attempt. Non-loopback
    # binds serve a network deliberately and skip the check.
    server.allowed_hosts = LOOPBACK_HOSTS if host.lower() in LOOPBACK_BINDS else None
    # server_address carries the real port, which matters for --port 0: bind an
    # ephemeral port for tests without guessing one in advance.
    port = server.server_address[1]
    url = url_for_host(host, port)
    print()
    print("  Language Tree")
    print(f"  {url}")
    print(f"  Data: {DATA_DIR}")
    print(f"  Project: {active or '(none)'}")
    print("  Press Ctrl+C to stop.")
    print()
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
