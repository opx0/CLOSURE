# /// script
# requires-python = ">=3.13"
# dependencies = [
#   "faster-whisper",
#   "piper-tts",
# ]
# ///
"""Local speech for CLOSER's voice UI: POST /transcribe (audio bytes -> text),
POST /speak (text -> WAV bytes). No prebuilt binary (whisper.cpp's server SIGILLs on some
CPUs); both models are pure-Python, loaded once, kept warm in process. No network model call.

Run: uv run voice/serve.py
"""

import http.server
import json
import os
import socketserver
import sys
import tempfile
import wave
from pathlib import Path

from faster_whisper import WhisperModel
from piper import PiperVoice
from piper.download_voices import download_voice

PORT = int(os.environ.get("VOICE_PORT", "8091"))
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base.en")
PIPER_VOICE_NAME = os.environ.get("PIPER_VOICE", "en_US-lessac-medium")
DATA_DIR = Path(os.environ.get("VOICE_DATA_DIR", ".closer/voice-models"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

print(f"loading whisper {WHISPER_MODEL}...", file=sys.stderr)
whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")

piper_model_path = DATA_DIR / f"{PIPER_VOICE_NAME}.onnx"
if not piper_model_path.exists():
    print(f"downloading piper voice {PIPER_VOICE_NAME}...", file=sys.stderr)
    download_voice(PIPER_VOICE_NAME, DATA_DIR)
print(f"loading piper {PIPER_VOICE_NAME}...", file=sys.stderr)
piper = PiperVoice.load(str(piper_model_path))


def speak(text: str) -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".wav") as out:
        with wave.open(out.name, "wb") as wf:
            piper.synthesize_wav(text, wf)
        return Path(out.name).read_bytes()


def transcribe(audio: bytes, suffix: str) -> str:
    with tempfile.NamedTemporaryFile(suffix=suffix) as f:
        f.write(audio)
        f.flush()
        # vad_filter strips silence/near-silence before it reaches the decoder. Without it, Whisper
        # doesn't say "I heard nothing" on quiet or noisy audio - it hallucinates a fluent sentence
        # from nothing (a well-known failure mode; ' You' on pure silence is the classic case).
        # Verified live: silence -> '' with this on, vs ' You' with it off; real speech unaffected.
        segments, _ = whisper.transcribe(f.name, vad_filter=True)
        return "".join(segment.text for segment in segments).strip()


class Handler(http.server.BaseHTTPRequestHandler):
    def _headers(self, code: int, content_type: str, length: int) -> None:
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.end_headers()

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self._headers(code, "application/json", len(body))
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self._headers(204, "text/plain", 0)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"status": "ok", "whisperModel": WHISPER_MODEL, "piperVoice": PIPER_VOICE_NAME})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            if self.path == "/speak":
                text = json.loads(body).get("text", "").strip()
                if not text:
                    self._json(400, {"error": "text is required"})
                    return
                wav = speak(text)
                self._headers(200, "audio/wav", len(wav))
                self.wfile.write(wav)
            elif self.path == "/transcribe":
                content_type = self.headers.get("Content-Type", "")
                suffix = ".webm" if "webm" in content_type else ".ogg" if "ogg" in content_type else ".wav"
                self._json(200, {"text": transcribe(body, suffix)})
            else:
                self._json(404, {"error": "not found"})
        except Exception as exc:  # noqa: BLE001 - always report as JSON, never a raw traceback
            self._json(502, {"error": str(exc)})

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write(f"{self.address_string()} - {fmt % args}\n")


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    server = ThreadingServer(("0.0.0.0", PORT), Handler)
    print(f"voice service ready on :{PORT}", file=sys.stderr)
    server.serve_forever()
