"""Stateful, offline sherpa-onnx recognition of 100 ms PCM16 frames.

This module is an adapter, not a network endpoint. A session keeps one recognizer stream from
the first frame through explicit Done; finalization never transcribes a saved whole-answer blob.
"""

import os
from pathlib import Path
from typing import Any

import numpy as np

SAMPLE_RATE = 16_000
FRAME_BYTES = 3_200


def load_recognizer(config: dict[str, str] | None = None) -> Any:
    env = os.environ if config is None else config
    paths = {
        name: env.get(f"VOICE_STREAM_{name.upper()}", "")
        for name in ("tokens", "encoder", "decoder", "joiner")
    }
    missing = [name for name, path in paths.items() if not path or not Path(path).is_file()]
    if missing:
        raise RuntimeError(
            f"Streaming ASR needs preprovisioned local files: {', '.join(missing)}; no download attempted"
        )
    import sherpa_onnx  # Import only after the offline asset check.

    return sherpa_onnx.OnlineRecognizer.from_transducer(
        **paths, sample_rate=SAMPLE_RATE, provider="cpu", num_threads=2,
        enable_endpoint_detection=False,
    )


class StreamingSession:
    def __init__(self, recognizer: Any):
        self.recognizer = recognizer
        self.stream = recognizer.create_stream()
        self.revision = 0
        self.text = ""
        self.finished = False
        self.stopped = False

    def _decode(self) -> dict[str, object] | None:
        while self.recognizer.is_ready(self.stream):
            self.recognizer.decode_stream(self.stream)
        text = self.recognizer.get_result_all(self.stream).text.strip()
        if text == self.text:
            return None
        self.text = text
        self.revision += 1
        return {"revision": self.revision, "text": text, "final": False}

    def push(self, pcm: bytes) -> dict[str, object] | None:
        if self.finished or self.stopped:
            raise RuntimeError("stream is closed")
        if len(pcm) != FRAME_BYTES:
            raise ValueError("expected exactly one 100 ms PCM16 mono frame")
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        self.stream.accept_waveform(SAMPLE_RATE, samples)
        return self._decode()

    def finish(self) -> dict[str, object]:
        if self.stopped:
            raise RuntimeError("stream was stopped")
        if not self.finished:
            self.stream.input_finished()
            self._decode()
            self.revision += 1
            self.finished = True
        return {"revision": self.revision, "text": self.text, "final": True}

    def stop(self) -> None:
        self.stopped = True
