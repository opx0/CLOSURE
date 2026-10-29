# /// script
# requires-python = ">=3.13"
# dependencies = ["numpy", "sherpa-onnx", "websockets>=16,<17"]
# ///
"""Loopback streaming ASR sidecar. The app server alone holds VOICE_STREAM_TOKEN."""

import asyncio
import json
import os
from collections.abc import Callable

from websockets.asyncio.server import ServerConnection, serve

from streaming import FRAME_BYTES, StreamingSession, load_recognizer


def stream_handler(recognizer, token: str) -> Callable[[ServerConnection], object]:
    protocol = f"lh-sidecar.{token}"
    decode_lock = asyncio.Lock()

    async def handle(socket: ServerConnection) -> None:
        if socket.subprotocol != protocol:
            await socket.close(1008, "not authorized")
            return
        session = StreamingSession(recognizer)
        expected = 0
        done_id = None
        async for message in socket:
            if isinstance(message, bytes):
                if len(message) != FRAME_BYTES + 4:
                    await socket.close(1003, "invalid PCM frame")
                    return
                seq = int.from_bytes(message[:4], "little")
                if seq != expected:
                    await socket.close(1008, "out-of-order frame")
                    return
                async with decode_lock:
                    update = await asyncio.to_thread(session.push, message[4:])
                expected += 1
                await socket.send(json.dumps({"kind": "ack", "seq": seq}))
                if update is not None:
                    await socket.send(json.dumps({"kind": "transcript", **update}))
                continue
            try:
                control = json.loads(message)
            except (ValueError, TypeError):
                await socket.close(1003, "invalid control")
                return
            if control.get("kind") == "stop":
                session.stop()
                await socket.close(1000)
                return
            if control.get("kind") != "done" or not isinstance(control.get("requestId"), str):
                await socket.close(1003, "invalid control")
                return
            if control.get("lastSeq") != expected - 1 or not control["requestId"]:
                await socket.close(1008, "incomplete answer")
                return
            if done_id is not None and done_id != control["requestId"]:
                await socket.close(1008, "conflicting Done")
                return
            done_id = control["requestId"]
            async with decode_lock:
                final = await asyncio.to_thread(session.finish)
            await socket.send(json.dumps({"kind": "transcript", **final}))
            await socket.close(1000)
            return

    return handle


async def main() -> None:
    token = os.environ.get("VOICE_STREAM_TOKEN", "")
    if len(token) < 16 or not all(char.isalnum() or char in "_-" for char in token):
        raise RuntimeError("VOICE_STREAM_TOKEN must be a private 16+ character URL-safe token")
    port = int(os.environ.get("VOICE_STREAM_PORT", "8092"))
    recognizer = load_recognizer()
    async with serve(
        stream_handler(recognizer, token), "127.0.0.1", port,
        subprotocols=[f"lh-sidecar.{token}"], compression=None,
        max_size=FRAME_BYTES + 4, max_queue=20,
    ):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
