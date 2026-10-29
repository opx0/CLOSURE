"""Loopback wire tests with a fake recognizer; no native model is claimed."""

import asyncio
import json
import unittest

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed, InvalidStatus

from stream_server import stream_handler
from streaming import FRAME_BYTES
from test_streaming import FakeRecognizer


class StreamServerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.token = "a-valid-local-token"
        self.server = await serve(
            stream_handler(FakeRecognizer(), self.token), "127.0.0.1", 0,
            subprotocols=[f"lh-sidecar.{self.token}"], compression=None,
        )
        self.port = self.server.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()

    async def test_explicit_done_finalizes_one_stream_after_incremental_text(self):
        async with connect(
            f"ws://127.0.0.1:{self.port}",
            subprotocols=[f"lh-sidecar.{self.token}"],
        ) as socket:
            await socket.send((0).to_bytes(4, "little") + b"\0" * FRAME_BYTES)
            self.assertEqual(json.loads(await socket.recv()), {"kind": "ack", "seq": 0})
            partial = json.loads(await socket.recv())
            self.assertEqual(partial["kind"], "transcript")
            self.assertFalse(partial["final"])
            await socket.send(json.dumps({"kind": "done", "requestId": "done-1", "lastSeq": 0}))
            final = json.loads(await socket.recv())
            self.assertTrue(final["final"])
            self.assertGreater(final["revision"], partial["revision"])

    async def test_wrong_protocol_and_reordered_frame_rejected(self):
        with self.assertRaises(InvalidStatus):
            async with connect(f"ws://127.0.0.1:{self.port}"):
                pass
        async with connect(
            f"ws://127.0.0.1:{self.port}",
            subprotocols=[f"lh-sidecar.{self.token}"],
        ) as socket:
            await socket.send((1).to_bytes(4, "little") + b"\0" * FRAME_BYTES)
            with self.assertRaises(ConnectionClosed):
                await asyncio.wait_for(socket.recv(), 2)


if __name__ == "__main__":
    unittest.main()
