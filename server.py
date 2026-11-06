#!/usr/bin/env python3
"""Local web server for Language Tree.

Serves the static frontend and a tiny JSON-file API. No third-party
dependencies are required. Every project is a JSON file in data/; the active
file is remembered in data/.active-project so the app reopens the same project
on the next run.
"""

from __future__ import annotations

import argparse
import json
import os
import threading
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

MAX_BODY_BYTES = 12 * 1024 * 1024  # Compressed bytes on the wire.
MAX_JSON_BYTES = 128 * 1024 * 1024  # Decompressed JSON limit.
SAVE_LOCK = threading.Lock()

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
    return host.split(":")[0]  # drop the port


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
        (entry.name for entry in DATA_DIR.iterdir() if entry.is_file() and entry.suffix.lower() == ".json"),
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


def read_project_file(name: str) -> dict:
    with project_path(name).open("r", encoding="utf-8") as handle:
        project = json.load(handle)
    validate_project(project)
    return project


def write_project(project: dict, name: str) -> None:
    """Write pretty JSON atomically, preserving a single-file git workflow."""
    path = project_path(name)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    text = json.dumps(project, ensure_ascii=False, indent=2) + "\n"
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def read_active_name() -> str | None:
    try:
        name = ACTIVE_FILE.read_text(encoding="utf-8-sig").strip()
    except OSError:
        return None
    return name or None


def write_active_name(name: str) -> None:
    project_path(name)  # Refuse anything that is not a plain project filename.
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temporary = ACTIVE_FILE.with_name(f"{ACTIVE_FILE.name}.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(f"{name}\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, ACTIVE_FILE)


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


def project_summary(name: str) -> dict:
    """List metadata, keeping a broken file visible instead of hiding it."""
    summary: dict = {"file": name}
    try:
        project = read_project_file(name)
    except (OSError, ValueError) as exc:
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
        self.wfile.write(body)

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
            except (OSError, ValueError) as exc:
                self.send_json({"error": f"Could not read project: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return
            self.send_json(project)
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
                # Stamp only after the revision check, under the same lock as
                # the write, so concurrent force-saves cannot share a stamp.
                project["updatedAt"] = utc_now()
                write_project(project, name)
        except OSError as exc:
            self.send_json({"error": f"Could not save project: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        self.send_json({"ok": True, "savedAt": project["updatedAt"], "file": name})

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
            self.send_json({"error": f"Could not switch project: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
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
        self.method_not_allowed()

    def do_DELETE(self) -> None:  # noqa: N802 (stdlib naming)
        self.method_not_allowed()

    def do_OPTIONS(self) -> None:  # noqa: N802 (stdlib naming)
        self.method_not_allowed()

    def do_PATCH(self) -> None:  # noqa: N802 (stdlib naming)
        self.method_not_allowed()


def ensure_data_files() -> None:
    """Create a first project and keep the active-project pointer usable."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not project_names():
        now = utc_now()
        write_project(
            {
                "version": 1,
                "title": "Example language family",
                "createdAt": now,
                "updatedAt": now,
                "languages": [],
            },
            SEED_PROJECT_NAME,
        )
    active = resolve_active_name()
    if active is not None and read_active_name() != active:
        write_active_name(active)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Language Tree web UI.")
    parser.add_argument("--host", default="127.0.0.1", help="Interface to bind (default: 127.0.0.1). Loopback binds refuse requests whose Host header names another machine.")
    parser.add_argument("--port", type=int, default=8765, help="Port to use (default: 8765)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser automatically")
    args = parser.parse_args()

    ensure_data_files()
    active = resolve_active_name()
    server = ThreadingHTTPServer((args.host, args.port), LanguageTreeHandler)
    # Loopback binds serve this machine only, so the Host header must say so
    # too; any other name is treated as a rebinding attempt. Non-loopback
    # binds serve a network deliberately and skip the check.
    server.allowed_hosts = LOOPBACK_HOSTS if args.host.strip().lower() in LOOPBACK_BINDS else None
    # server_address carries the real port, which matters for --port 0: bind an
    # ephemeral port for tests without guessing one in advance.
    port = server.server_address[1]
    url = f"http://{args.host}:{port}/"
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
