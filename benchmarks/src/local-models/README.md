# Local model comparison

`bun run models:preflight CANDIDATES.json NEW_REPORT.json` verifies the local artifact
paths and SHA-256 digests for at most three candidates. It does not load or select a model.

For a streaming ASR candidate, start the local sidecar with its preprovisioned assets,
then set `VOICE_STREAM_TOKEN` and optionally `VOICE_STREAM_URL`. Run:

```sh
bun run models:asr:run CANDIDATES.json CANDIDATE_ID CASES.json NEW_REPORT.json
```

`CASES.json` is an array of 1–20 reviewed cases. Each entry has `id`, `wavPath`,
`sha256` (the WAV digest), `reference` (reviewed transcript), `criticalPhrases`
(literal phrases from that transcript whose loss changes the meaning), and
`reviewedBy` (the reviewer identifier). WAV files must be mono PCM16 at 16 kHz,
no longer than one minute. The runner sends 100 ms frames to a loopback recognizer
at real-time pace and records the final transcript, word error rate, missing
critical phrases, elapsed time, and final lag after the last audio frame.

The report does not verify that the already running sidecar loaded the candidate
listed in the manifest. Confirm its runtime and loaded artifact digests separately.
Batch ASR, LLM, TTS, concurrent resource measurements, and model selection stay
unset until their real comparisons are run. A scripted recognizer test checks the
protocol and calculations; it is not a model-quality result.
