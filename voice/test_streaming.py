"""Adapter behavior with a fake recognizer; this is not a model-quality test."""

import tempfile
import unittest
from pathlib import Path

from streaming import FRAME_BYTES, StreamingSession, load_recognizer


class FakeStream:
    def __init__(self):
        self.waveforms = []
        self.done = False

    def accept_waveform(self, sample_rate, samples):
        self.waveforms.append((sample_rate, samples))

    def input_finished(self):
        self.done = True


class FakeRecognizer:
    def create_stream(self):
        return FakeStream()

    def is_ready(self, stream):
        return len(stream.waveforms) > 0 or (stream.done and not hasattr(stream, "drained"))

    def decode_stream(self, stream):
        stream.waveforms.clear()
        if stream.done:
            stream.drained = True

    def get_result_all(self, stream):
        return type("Result", (), {"text": "a provisional answer" if not stream.done else "a final answer"})()


class StreamingTests(unittest.TestCase):
    def test_missing_assets_fail_before_import_or_download(self):
        with self.assertRaisesRegex(RuntimeError, "preprovisioned local files"):
            load_recognizer({})
        with tempfile.TemporaryDirectory() as directory:
            paths = {}
            for name in ("tokens", "encoder", "decoder", "joiner"):
                path = Path(directory) / name
                path.write_bytes(b"stub")
                paths[f"VOICE_STREAM_{name.upper()}"] = str(path)
            paths["VOICE_STREAM_JOINER"] = str(Path(directory) / "absent")
            with self.assertRaisesRegex(RuntimeError, "joiner"):
                load_recognizer(paths)

    def test_partial_text_is_not_final_and_done_does_not_reprocess_audio(self):
        session = StreamingSession(FakeRecognizer())
        with self.assertRaisesRegex(ValueError, "100 ms"):
            session.push(b"short")
        partial = session.push(b"\0" * FRAME_BYTES)
        self.assertEqual(partial, {"revision": 1, "text": "a provisional answer", "final": False})
        self.assertIsNone(session.push(b"\0" * FRAME_BYTES))
        self.assertFalse(session.stream.done)
        self.assertEqual(session.finish(), {"revision": 3, "text": "a final answer", "final": True})
        self.assertEqual(session.finish(), {"revision": 3, "text": "a final answer", "final": True})
        with self.assertRaisesRegex(RuntimeError, "closed"):
            session.push(b"\0" * FRAME_BYTES)

    def test_stop_rejects_late_finalization(self):
        session = StreamingSession(FakeRecognizer())
        session.stop()
        with self.assertRaisesRegex(RuntimeError, "stopped"):
            session.finish()


if __name__ == "__main__":
    unittest.main()
