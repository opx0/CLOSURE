"""Startup policy checks without installing or loading speech models."""

import os
import http.client
import runpy
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("serve.py")


class SpeechStartupTest(unittest.TestCase):
    def start(self, model_cached: bool, piper_files: tuple[str, ...] = (), local_only: bool = True,
              request: tuple[str, dict[str, str], bytes] | None = None):
        calls = []

        def whisper_model(name, **kwargs):
            calls.append(("whisper", kwargs))
            if not model_cached and kwargs["local_files_only"]:
                raise OSError("model not cached")
            return object()

        def download_voice(name, directory):
            calls.append(("download", name))

        modules = {
            "numpy": types.ModuleType("numpy"),
            "faster_whisper": types.ModuleType("faster_whisper"),
            "faster_whisper.audio": types.ModuleType("faster_whisper.audio"),
            "piper": types.ModuleType("piper"),
            "piper.download_voices": types.ModuleType("piper.download_voices"),
            "prosody": types.ModuleType("prosody"),
        }
        modules["faster_whisper"].WhisperModel = whisper_model
        modules["faster_whisper.audio"].decode_audio = lambda *args: None
        modules["piper"].PiperVoice = types.SimpleNamespace(load=lambda path: calls.append(("piper", path)))
        modules["piper.download_voices"].download_voice = download_voice
        for name in ("intensity_track", "pitch_track", "terminal_contours"):
            setattr(modules["prosody"], name, lambda *args: None)

        with tempfile.TemporaryDirectory() as directory:
            for filename in piper_files:
                (Path(directory) / filename).touch()
            env = {
                "VOICE_DATA_DIR": directory,
                "LEVELHEAD_LOCAL_ONLY": "true" if local_only else "false",
            }
            with patch.dict(sys.modules, modules), patch.dict(os.environ, env):
                try:
                    module = runpy.run_path(str(SCRIPT), run_name="speech_policy_test")
                    if request:
                        with module["ThreadingServer"](("127.0.0.1", 0), module["Handler"]) as server:
                            thread = threading.Thread(target=server.serve_forever, daemon=True)
                            thread.start()
                            connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
                            method, headers, body = request
                            connection.request(method, "/transcribe", body, headers)
                            response = connection.getresponse()
                            calls.append(("http", response.status, response.getheader("Access-Control-Allow-Origin")))
                            response.read()
                            connection.close()
                            server.shutdown()
                            thread.join()
                except RuntimeError as error:
                    return calls, str(error)
        return calls, None

    def test_missing_whisper_fails_without_download(self):
        calls, error = self.start(model_cached=False)
        self.assertIn("not cached", error)
        self.assertEqual(calls[0][1]["local_files_only"], True)
        self.assertNotIn("download", [call[0] for call in calls])

    def test_missing_piper_config_fails_without_download(self):
        calls, error = self.start(model_cached=True, piper_files=("en_US-lessac-medium.onnx",))
        self.assertIn("model/config missing", error)
        self.assertNotIn("download", [call[0] for call in calls])

    def test_provisioned_assets_load_without_download(self):
        calls, error = self.start(
            model_cached=True,
            piper_files=("en_US-lessac-medium.onnx", "en_US-lessac-medium.onnx.json"),
        )
        self.assertIsNone(error)
        self.assertEqual([call[0] for call in calls], ["whisper", "piper"])

    def test_non_local_mode_retains_first_run_download(self):
        calls, error = self.start(model_cached=False, local_only=False)
        self.assertIsNone(error)
        self.assertEqual([call[0] for call in calls], ["whisper", "download", "piper"])
        self.assertEqual(calls[0][1]["local_files_only"], False)

    def test_untrusted_origin_is_rejected_before_inference(self):
        files = ("en_US-lessac-medium.onnx", "en_US-lessac-medium.onnx.json")
        calls, error = self.start(True, files, request=("POST", {"Origin": "https://untrusted.example"}, b"audio"))
        self.assertIsNone(error)
        self.assertEqual(calls[-1], ("http", 403, None))

    def test_oversized_audio_is_rejected_before_reading_body(self):
        files = ("en_US-lessac-medium.onnx", "en_US-lessac-medium.onnx.json")
        calls, error = self.start(True, files, request=("POST", {
            "Origin": "http://localhost:3001", "Content-Length": str(10 * 1024 * 1024 + 1)
        }, b""))
        self.assertIsNone(error)
        self.assertEqual(calls[-1], ("http", 413, "http://localhost:3001"))

    def test_preflight_only_allows_configured_origin(self):
        files = ("en_US-lessac-medium.onnx", "en_US-lessac-medium.onnx.json")
        calls, error = self.start(True, files, request=("OPTIONS", {"Origin": "http://localhost:3001"}, b""))
        self.assertIsNone(error)
        self.assertEqual(calls[-1], ("http", 204, "http://localhost:3001"))


if __name__ == "__main__":
    unittest.main()
