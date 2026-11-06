"""Offline regressions for the GitHub receiver; no requests or credentials."""
import base64
import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError


spec = importlib.util.spec_from_file_location("sync_meter", Path(__file__).with_name("sync-meter.py"))
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


def fixture():
    data = {path: ("fixture:" + path).encode("utf-8") for path in receiver.FILES}
    checksums = {path: receiver.digest(content) for path, content in data.items()}
    payload = {
        "schema": receiver.SCHEMA, "repository": receiver.REPOSITORY,
        "directory": receiver.DIRECTORY, "site_url": receiver.SITE_URL,
        "release_hash": receiver.bundle_hash(checksums),
        "files": [{"path": path, "encoding": "base64", "content": base64.b64encode(data[path]).decode("ascii"),
                   "sha256": checksums[path]} for path in receiver.FILES],
    }
    return payload, data


class FakeResponse:
    def __init__(self, body, url=receiver.SOURCE, content_type="application/json"):
        self.body, self.url, self.status = body, url, 200
        self.headers = {"Content-Type": content_type}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def read(self, size):
        return self.body[:size]


class ReceiverTests(unittest.TestCase):
    def test_validates_and_writes_exact_seven_then_noop(self):
        payload, data = fixture()
        decoded, checksum = receiver.validate_manifest(payload)
        self.assertEqual(decoded, data)
        self.assertEqual(checksum, payload["release_hash"])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "untouched.txt").write_text("preserve")
            self.assertTrue(receiver.sync_files(root, decoded))
            self.assertFalse(receiver.sync_files(root, decoded))
            self.assertEqual({str(path.relative_to(root)) for path in (root / receiver.DIRECTORY).iterdir()}, set(receiver.FILES))
            self.assertEqual((root / "untouched.txt").read_text(), "preserve")
            self.assertEqual({path: (root / path).read_bytes() for path in receiver.FILES}, data)

    def test_identity_and_metadata_rejection(self):
        original, _ = fixture()
        for field, value in [("schema", "other"), ("repository", "other/repo"), ("directory", "../other"),
                             ("site_url", "https://example.com"), ("release_hash", "A" * 64)]:
            with self.subTest(field=field):
                payload = copy.deepcopy(original)
                payload[field] = value
                with self.assertRaises(ValueError):
                    receiver.validate_manifest(payload)
        payload = copy.deepcopy(original)
        payload["token"] = "unexpected"
        with self.assertRaises(ValueError):
            receiver.validate_manifest(payload)

    def test_missing_duplicate_reordered_and_traversal_paths_rejected(self):
        original, _ = fixture()
        cases = []
        payload = copy.deepcopy(original); payload["files"].pop(); cases.append(payload)
        payload = copy.deepcopy(original); payload["files"][1] = payload["files"][0]; cases.append(payload)
        payload = copy.deepcopy(original); payload["files"][0], payload["files"][1] = payload["files"][1], payload["files"][0]; cases.append(payload)
        payload = copy.deepcopy(original); payload["files"][0]["path"] = "poco-meter/../index.html"; cases.append(payload)
        for payload in cases:
            with self.subTest(paths=[entry["path"] for entry in payload["files"]]):
                with self.assertRaises(ValueError):
                    receiver.validate_manifest(payload)

    def test_encoding_bytes_and_aggregate_checksums_rejected(self):
        original, _ = fixture()
        for field, value in [("encoding", "utf8"), ("content", "%%%"), ("sha256", "0" * 64),
                             ("content", ""), ("content", "YQ==\n")]:
            payload = copy.deepcopy(original)
            payload["files"][0][field] = value
            with self.subTest(field=field, value=value):
                with self.assertRaises(ValueError):
                    receiver.validate_manifest(payload)
        payload = copy.deepcopy(original)
        payload["release_hash"] = "0" * 64
        with self.assertRaises(ValueError):
            receiver.validate_manifest(payload)

    def test_per_file_and_bundle_limits_rejected_before_writes(self):
        payload, _ = fixture()
        with patch.object(receiver, "MAX_FILE", 2):
            with self.assertRaises(ValueError):
                receiver.validate_manifest(payload)
        with patch.object(receiver, "MAX_TOTAL", 2):
            with self.assertRaises(ValueError):
                receiver.validate_manifest(payload)

    def test_corrupt_manifest_does_not_change_existing_files(self):
        payload, data = fixture()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            receiver.sync_files(root, data)
            payload["files"][-1]["sha256"] = "0" * 64
            with self.assertRaises(ValueError):
                decoded, _ = receiver.validate_manifest(payload)
                receiver.sync_files(root, decoded)
            self.assertEqual({path: (root / path).read_bytes() for path in receiver.FILES}, data)

    def test_symlink_directory_and_file_never_written(self):
        _, data = fixture()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            other = root / "other"; other.mkdir()
            (root / receiver.DIRECTORY).symlink_to(other, target_is_directory=True)
            with self.assertRaises(ValueError):
                receiver.sync_files(root, data)
            self.assertEqual(list(other.iterdir()), [])
            (root / receiver.DIRECTORY).unlink(); (root / receiver.DIRECTORY).mkdir()
            victim = other / "file"; victim.write_bytes(b"private")
            (root / receiver.FILES[0]).symlink_to(victim)
            with self.assertRaises(ValueError):
                receiver.sync_files(root, data)
            self.assertEqual(victim.read_bytes(), b"private")

    def test_replace_failure_restores_existing_bundle(self):
        _, old = fixture()
        new = {path: content + b":new" for path, content in old.items()}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            receiver.sync_files(root, old)
            replace = receiver.os.replace
            calls = 0

            def fail_second(*args):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("simulated write failure")
                return replace(*args)

            with patch.object(receiver.os, "replace", side_effect=fail_second):
                with self.assertRaisesRegex(RuntimeError, "existing files were restored"):
                    receiver.sync_files(root, new)
            self.assertEqual({path: (root / path).read_bytes() for path in receiver.FILES}, old)
            self.assertFalse(any(path.name.startswith(".meter-sync-") for path in root.iterdir()))

    def test_first_install_failure_leaves_no_partial_bundle(self):
        _, data = fixture()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            replace = receiver.os.replace
            calls = 0

            def fail_second(*args):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("simulated write failure")
                return replace(*args)

            with patch.object(receiver.os, "replace", side_effect=fail_second):
                with self.assertRaises(RuntimeError):
                    receiver.sync_files(root, data)
            self.assertEqual(list(root.iterdir()), [])

    def test_http_fetch_reads_json_with_no_credentials(self):
        payload, _ = fixture()
        body = json.dumps(payload).encode("utf-8")
        with patch.object(receiver.HTTP, "open", return_value=FakeResponse(body)) as open_request:
            self.assertEqual(receiver.fetch_manifest(), payload)
        request = open_request.call_args.args[0]
        self.assertEqual(request.full_url, receiver.SOURCE)
        self.assertFalse(any("authorization" in key.lower() or "cookie" in key.lower() for key, _ in request.header_items()))
        self.assertEqual(open_request.call_args.kwargs, {"timeout": 30})

    def test_transient_5xx_retried_exactly_once(self):
        payload, _ = fixture()
        error = HTTPError(receiver.SOURCE, 503, "unavailable", {}, None)
        with patch.object(receiver.HTTP, "open", side_effect=[error, FakeResponse(json.dumps(payload).encode())]) as opened, patch.object(receiver.time, "sleep"):
            self.assertEqual(receiver.fetch_manifest(), payload)
            self.assertEqual(opened.call_count, 2)
        with patch.object(receiver.HTTP, "open", side_effect=[HTTPError(receiver.SOURCE, 503, "unavailable", {}, None), HTTPError(receiver.SOURCE, 502, "unavailable", {}, None)]) as opened, patch.object(receiver.time, "sleep"):
            with self.assertRaisesRegex(ValueError, "HTTP 502"):
                receiver.fetch_manifest()
            self.assertEqual(opened.call_count, 2)

    def test_403_and_429_not_retried(self):
        for code in [403, 429]:
            with self.subTest(code=code), patch.object(receiver.HTTP, "open", side_effect=HTTPError(receiver.SOURCE, code, "rejected", {}, None)) as opened:
                with self.assertRaisesRegex(ValueError, "HTTP " + str(code)):
                    receiver.fetch_manifest()
                self.assertEqual(opened.call_count, 1)

    def test_transient_communication_retried_once(self):
        payload, _ = fixture()
        for error in [TimeoutError("timeout"), URLError("connection reset")]:
            with self.subTest(error=type(error).__name__), patch.object(receiver.HTTP, "open", side_effect=[error, FakeResponse(json.dumps(payload).encode())]) as opened, patch.object(receiver.time, "sleep"):
                self.assertEqual(receiver.fetch_manifest(), payload)
                self.assertEqual(opened.call_count, 2)
        with patch.object(receiver.HTTP, "open", side_effect=TimeoutError("timeout")) as opened, patch.object(receiver.time, "sleep"):
            with self.assertRaisesRegex(ValueError, "one communication retry"):
                receiver.fetch_manifest()
            self.assertEqual(opened.call_count, 2)

    def test_public_check_reads_all_paths_and_detects_stale_file(self):
        payload, data = fixture()
        checksums = {entry["path"]: entry["sha256"] for entry in payload["files"]}
        with patch.object(receiver, "read_public_file", side_effect=lambda path, checksum, timeout: data[path]) as read:
            self.assertTrue(receiver.public_matches(checksums))
            self.assertEqual(read.call_count, 7)
            self.assertEqual({call.args[0] for call in read.call_args_list}, set(receiver.FILES))
        with patch.object(receiver, "read_public_file", side_effect=lambda path, checksum, timeout: b"stale" if path == receiver.FILES[3] else data[path]):
            self.assertFalse(receiver.public_matches(checksums))

    def test_public_permission_failure_is_not_hidden_by_an_earlier_stale_file(self):
        payload, data = fixture()
        checksums = {entry["path"]: entry["sha256"] for entry in payload["files"]}

        def read(path, *_):
            if path == receiver.FILES[-1]:
                raise ValueError("GitHub public verification failed (HTTP 403).")
            return b"stale" if path == receiver.FILES[0] else data[path]

        with patch.object(receiver, "read_public_file", side_effect=read):
            with self.assertRaisesRegex(ValueError, "HTTP 403"):
                receiver.public_matches(checksums)

    def test_public_read_is_uncredentialed_and_does_not_retry_403(self):
        with patch.object(receiver.PUBLIC_HTTP, "open", return_value=FakeResponse(b"page", url=receiver.PUBLIC_ROOT)) as opened:
            self.assertEqual(receiver.read_public_file(receiver.FILES[0], "0" * 64, 8), b"page")
            request = opened.call_args.args[0]
            self.assertEqual(request.full_url, receiver.PUBLIC_ROOT + "?sync=" + "0" * 64)
            self.assertFalse(any("authorization" in key.lower() or "cookie" in key.lower() for key, _ in request.header_items()))
        with patch.object(receiver.PUBLIC_HTTP, "open", side_effect=HTTPError(receiver.PUBLIC_ROOT, 403, "rejected", {}, None)) as opened:
            with self.assertRaisesRegex(ValueError, "HTTP 403"):
                receiver.read_public_file(receiver.FILES[0], "0" * 64, 8)
            self.assertEqual(opened.call_count, 1)

    def test_unchanged_bundle_rebuilds_stale_pages_and_stays_noop_when_public_matches(self):
        payload, data = fixture()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            receiver.sync_files(root, data)
            manifest = root / "manifest.json"; manifest.write_text(json.dumps(payload))
            argv = ["sync-meter.py", "--manifest-file", str(manifest), "--output-root", str(root)]
            for matches, rebuild in [(False, True), (True, False)]:
                with self.subTest(matches=matches), patch.object(receiver.sys, "argv", argv), patch.object(receiver, "public_matches", return_value=matches), patch.object(receiver, "output") as output:
                    receiver.main()
                    output.assert_any_call("changed", False)
                    output.assert_any_call("rebuild", rebuild)

    def test_public_verification_does_not_claim_success_on_stale_data(self):
        _, data = fixture()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            receiver.sync_files(root, data)
            with patch.object(receiver, "public_matches", return_value=True) as matches, patch("builtins.print") as printed:
                receiver.verify_public(root)
                self.assertEqual(matches.call_count, 1)
                printed.assert_called_once_with("GitHub Pages serves all seven synchronized meter files.")
            # Advance the fake clock beyond the deadline immediately after one check.
            with patch.object(receiver, "public_matches", return_value=False), patch.object(receiver.time, "monotonic", side_effect=[0, 0, 0, 181, 181]):
                with self.assertRaisesRegex(RuntimeError, "next hourly run"):
                    receiver.verify_public(root)

    def test_final_origin_content_type_and_http_size_rejected(self):
        payload, _ = fixture()
        body = json.dumps(payload).encode("utf-8")
        for response in [FakeResponse(body, url="https://example.com/github-meter-release.json"),
                         FakeResponse(body, url=receiver.SOURCE.replace("https:", "http:")),
                         FakeResponse(body, content_type="text/html")]:
            with patch.object(receiver.HTTP, "open", return_value=response):
                with self.assertRaises(ValueError):
                    receiver.fetch_manifest()
        with patch.object(receiver, "MAX_RESPONSE", 2), patch.object(receiver.HTTP, "open", return_value=FakeResponse(body)):
            with self.assertRaisesRegex(ValueError, "size limit"):
                receiver.fetch_manifest()

    def test_cross_origin_redirect_rejected_before_follow(self):
        handler = receiver.SitesRedirectHandler()
        for url in ["https://example.com/", "http://poco-meter.freefreelife2000.chatgpt.site/", "https://user@poco-meter.freefreelife2000.chatgpt.site/"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                handler.redirect_request(None, None, 302, "redirect", {}, url)

    def test_wrong_repository_refused_before_any_read(self):
        with patch.dict(receiver.os.environ, {"GITHUB_REPOSITORY": "other/repository"}), patch.object(receiver, "fetch_manifest") as fetch, patch.object(receiver.sys, "argv", ["sync-meter.py"]):
            with self.assertRaisesRegex(ValueError, "configured GitHub repository"):
                receiver.main()
            fetch.assert_not_called()

    def test_workflow_scopes_trigger_commit_and_no_force_push(self):
        workflow = Path(__file__).with_name("sync-pococha-meter.yml").read_text()
        self.assertIn("cron: '17 * * * *'", workflow)
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("contents: write", workflow)
        self.assertIn("pages: write", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertIn("github.repository == '" + receiver.REPOSITORY + "'", workflow)
        self.assertIn("uses: actions/checkout@v4", workflow)
        self.assertIn("git push origin HEAD:main", workflow)
        self.assertIn('gh api --method POST "repos/$GITHUB_REPOSITORY/pages/builds"', workflow)
        self.assertIn("python3 .github/scripts/sync-meter.py --verify-public", workflow)
        self.assertNotIn("--force", workflow)
        for line in workflow.splitlines():
            if "git add --" in line:
                self.assertEqual(line.split("git add --", 1)[1].split(), list(receiver.FILES))


if __name__ == "__main__":
    unittest.main(verbosity=2)
