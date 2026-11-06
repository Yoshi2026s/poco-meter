"""Receive the public, validated Sites meter export without executing its code.

Install in .github/scripts/sync-meter.py in the designated GitHub repository.
All seven files are validated before any destination is changed. Each file is
replaced atomically; an ordinary write failure rolls back replacements already
made. A process/host interruption cannot provide a multi-file transaction, so
GitHub publishes the bundle only after this command and its commit succeed.
"""
import argparse
import base64
import binascii
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


SCHEMA = "pococha-meter-github-v1"
REPOSITORY = "pococha2026/pococha2026.github.io"
DIRECTORY = "poco-meter"
SITE_URL = "https://poco-meter.freefreelife2000.chatgpt.site"
SOURCE = SITE_URL + "/github-meter-release.json"
PUBLIC_ORIGIN = "https://pococha2026.github.io"
PUBLIC_ROOT = PUBLIC_ORIGIN + "/poco-meter/"
FILES = tuple(DIRECTORY + "/" + name for name in (
    "index.html", "calculation-methods.html", "meter-sw.js", "meter.webmanifest",
    "meter-icon-180.png", "meter-icon-192.png", "meter-icon-512.png",
))
MAX_RESPONSE = 12 * 1024 * 1024
MAX_TOTAL = 8 * 1024 * 1024
MAX_FILE = 4 * 1024 * 1024
HEX = re.compile(r"[0-9a-f]{64}\Z")
TOP_FIELDS = {"schema", "repository", "directory", "site_url", "release_hash", "files"}
FILE_FIELDS = {"path", "encoding", "content", "sha256"}


class ConfiguredRedirectHandler(HTTPRedirectHandler):
    def __init__(self, origin):
        super().__init__()
        self.origin = origin

    def redirect_request(self, request, response, code, message, headers, new_url):
        redirected, expected = urlparse(new_url), urlparse(self.origin)
        if (redirected.scheme != "https" or redirected.netloc != expected.netloc or
                redirected.username or redirected.password):
            raise ValueError("A public request redirected outside its configured HTTPS origin.")
        return super().redirect_request(request, response, code, message, headers, new_url)


class SitesRedirectHandler(ConfiguredRedirectHandler):
    def __init__(self):
        super().__init__(SITE_URL)


HTTP = build_opener(SitesRedirectHandler())
PUBLIC_HTTP = build_opener(ConfiguredRedirectHandler(PUBLIC_ORIGIN))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def bundle_hash(checksums):
    """Match the producer's fixed-order path/newline/checksum/newline hash."""
    return digest("".join(path + "\n" + checksums[path] + "\n" for path in FILES).encode("utf-8"))


def fetch_manifest():
    request = Request(SOURCE, headers={
        "User-Agent": "PocochaMeterSync/1.0", "Cache-Control": "no-cache",
        "Accept": "application/json",
    })
    for attempt in range(2):
        try:
            with HTTP.open(request, timeout=30) as response:
                final = urlparse(response.url)
                expected = urlparse(SITE_URL)
                if response.status != 200 or final.scheme != "https" or final.netloc != expected.netloc or final.username or final.password:
                    raise ValueError("The export must come from the configured Sites HTTPS origin.")
                if response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                    raise ValueError("The public export did not return JSON.")
                data = response.read(MAX_RESPONSE + 1)
                if len(data) > MAX_RESPONSE:
                    raise ValueError("The export exceeded its size limit.")
                return json.loads(data.decode("utf-8"))
        except HTTPError as error:
            # No retry/bypass for authentication, permission, or rate limits.
            if attempt == 0 and 500 <= error.code <= 599:
                error.close()
                time.sleep(1)
                continue
            raise ValueError("Public export retrieval failed (HTTP %s)." % error.code) from None
        except (URLError, TimeoutError):
            if attempt == 0:
                time.sleep(1)
                continue
            raise ValueError("Public export retrieval failed after one communication retry.") from None


class PublicUnavailable(ValueError):
    """A missing/stale public bundle may be checked again after Pages rebuild."""


def read_public_file(path, checksum, timeout):
    relative = path.removeprefix(DIRECTORY + "/")
    url = PUBLIC_ROOT + ("" if relative == "index.html" else relative) + "?sync=" + checksum
    request = Request(url, headers={"User-Agent": "PocochaMeterSync/1.0", "Cache-Control": "no-cache"})
    for attempt in range(2):
        try:
            with PUBLIC_HTTP.open(request, timeout=timeout) as response:
                final = urlparse(response.url)
                if (response.status != 200 or final.scheme != "https" or final.netloc != urlparse(PUBLIC_ORIGIN).netloc or
                        final.username or final.password):
                    raise ValueError("GitHub verification returned an unexpected origin or response.")
                content = response.read(MAX_FILE + 1)
                if len(content) > MAX_FILE:
                    raise ValueError("A GitHub public file exceeded its size limit.")
                return content
        except HTTPError as error:
            if attempt == 0 and 500 <= error.code <= 599:
                error.close()
                time.sleep(1)
                continue
            if error.code == 404 or 500 <= error.code <= 599:
                raise PublicUnavailable("The GitHub bundle is not available yet.") from None
            raise ValueError("GitHub public verification failed (HTTP %s)." % error.code) from None
        except (URLError, TimeoutError):
            if attempt == 0:
                time.sleep(1)
                continue
            raise PublicUnavailable("GitHub public files could not be retrieved.") from None


def public_matches(checksums, timeout=8):
    def matches(path):
        try:
            return digest(read_public_file(path, checksums[path], timeout)) == checksums[path]
        except PublicUnavailable:
            return False

    # Seven parallel bounded reads avoid a serial timeout for every asset.
    with ThreadPoolExecutor(max_workers=len(FILES)) as executor:
        results = list(executor.map(matches, FILES))
        return all(results)


def verify_public(root):
    originals = inspect_destination(Path(root).resolve(strict=True))
    if any(originals[path] is None for path in FILES):
        raise ValueError("All seven local files are required for publication verification.")
    checksums = {path: digest(originals[path]) for path in FILES}
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        if public_matches(checksums, timeout=min(8, max(1, remaining / 2))):
            print("GitHub Pages serves all seven synchronized meter files.")
            return
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(5, remaining))
    raise RuntimeError("Repository files are synchronized, but GitHub Pages publication has not been confirmed; the next hourly run will retry the Pages rebuild.")


def validate_manifest(payload):
    if not isinstance(payload, dict) or set(payload) != TOP_FIELDS:
        raise ValueError("Unexpected export fields.")
    if (payload["schema"] != SCHEMA or payload["repository"] != REPOSITORY or
            payload["directory"] != DIRECTORY or payload["site_url"] != SITE_URL):
        raise ValueError("Export identity or destination did not match.")
    release_hash = payload["release_hash"]
    if not isinstance(release_hash, str) or not HEX.fullmatch(release_hash):
        raise ValueError("Invalid bundle checksum.")
    entries = payload["files"]
    if not isinstance(entries, list) or len(entries) != len(FILES):
        raise ValueError("The export must contain exactly seven files.")
    decoded, checksums, total = {}, {}, 0
    for expected_path, entry in zip(FILES, entries):
        if not isinstance(entry, dict) or set(entry) != FILE_FIELDS:
            raise ValueError("Unexpected file entry fields.")
        if entry["path"] != expected_path or entry["encoding"] != "base64":
            raise ValueError("Unexpected file path, order, or encoding.")
        content, checksum = entry["content"], entry["sha256"]
        if not isinstance(content, str) or not isinstance(checksum, str) or not HEX.fullmatch(checksum):
            raise ValueError("Missing file content or checksum.")
        if len(content) > ((MAX_FILE + 2) // 3) * 4:
            raise ValueError("A file exceeded its encoded size limit.")
        try:
            data = base64.b64decode(content, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError("Invalid base64 file content.") from None
        # Canonical encoding avoids distinct encoded representations of one bundle.
        if base64.b64encode(data).decode("ascii") != content:
            raise ValueError("Noncanonical base64 file content.")
        total += len(data)
        if not data or len(data) > MAX_FILE or total > MAX_TOTAL:
            raise ValueError("A file or bundle exceeded its decoded size limit.")
        if digest(data) != checksum:
            raise ValueError("A file checksum did not match its bytes.")
        decoded[expected_path], checksums[expected_path] = data, checksum
    if bundle_hash(checksums) != release_hash:
        raise ValueError("The bundle checksum did not match its files.")
    return decoded, release_hash


def inspect_destination(root):
    directory = root / DIRECTORY
    if directory.is_symlink() or directory.exists() and not directory.is_dir():
        raise ValueError("The destination directory must be a normal directory.")
    originals = {}
    for path in FILES:
        target = root / path
        if target.is_symlink():
            raise ValueError("The destination files must not be symlinks.")
        if target.exists():
            if not stat.S_ISREG(target.stat().st_mode):
                raise ValueError("The destination files must be regular files.")
            if target.stat().st_size > MAX_FILE:
                raise ValueError("An existing destination exceeded the file size limit.")
            originals[path] = target.read_bytes()
        else:
            originals[path] = None
    return originals


def sync_files(root, files):
    root = Path(root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("The checkout root must be a directory.")
    originals = inspect_destination(root)
    changes = [path for path in FILES if originals[path] != files[path]]
    if not changes:
        return False
    directory = root / DIRECTORY
    existed = directory.exists()
    replaced = []
    with tempfile.TemporaryDirectory(prefix=".meter-sync-", dir=root) as temporary:
        staged = Path(temporary)
        # Stage the entire changed bundle before touching the live destination.
        for path in changes:
            (staged / Path(path).name).write_bytes(files[path])
        try:
            directory.mkdir(exist_ok=True)
            for path in changes:
                os.replace(staged / Path(path).name, root / path)
                replaced.append(path)
        except Exception as failure:
            rollback_errors = []
            for path in reversed(replaced):
                try:
                    if originals[path] is None:
                        (root / path).unlink()
                    else:
                        restore = staged / (Path(path).name + ".restore")
                        restore.write_bytes(originals[path])
                        os.replace(restore, root / path)
                except Exception:
                    rollback_errors.append(path)
            if not existed:
                try:
                    directory.rmdir()
                except OSError:
                    pass
            if rollback_errors:
                raise RuntimeError("A local write failed and rollback could not restore every file; no commit should be made.") from failure
            raise RuntimeError("A local write failed; existing files were restored.") from failure
    return True


def output(name, value):
    value = str(value).lower() if isinstance(value, bool) else str(value)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
            stream.write(name + "=" + value + "\n")
    print(name + "=" + value)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest-file", type=Path, help="Validate a local manifest without network access.")
    parser.add_argument("--output-root", type=Path, default=Path.cwd(), help="Checkout root containing poco-meter/.")
    parser.add_argument("--offline", action="store_true", help="Skip public checks during offline/local validation.")
    parser.add_argument("--verify-public", action="store_true", help="Wait up to three minutes for the committed seven-file bundle on GitHub Pages.")
    args = parser.parse_args()
    repository = os.environ.get("GITHUB_REPOSITORY")
    if repository and repository != REPOSITORY:
        raise ValueError("This receiver can run only in its configured GitHub repository.")
    if args.verify_public:
        if args.offline:
            raise ValueError("Publication verification requires public reads.")
        verify_public(args.output_root)
        return
    if args.manifest_file:
        if args.manifest_file.stat().st_size > MAX_RESPONSE:
            raise ValueError("The local export exceeded its size limit.")
        payload = json.loads(args.manifest_file.read_text(encoding="utf-8"))
    else:
        payload = fetch_manifest()
    files, checksum = validate_manifest(payload)
    changed = sync_files(args.output_root, files)
    output("changed", changed)
    output("release_hash", checksum)
    checksums = {path: digest(content) for path, content in files.items()}
    # A failed Pages build after a successful commit must not be stuck at no-op.
    output("rebuild", False if args.offline else changed or not public_matches(checksums))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Do not log response bodies, exported contents, or authentication values.
        message = str(error) if isinstance(error, (ValueError, RuntimeError)) else "The export could not be retrieved or saved."
        print("Meter synchronization stopped: " + message, file=sys.stderr)
        sys.exit(1)
