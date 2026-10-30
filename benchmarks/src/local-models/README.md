# Local model comparison

`bun run models:preflight CANDIDATES.json NEW_REPORT.json` verifies the local artifact
paths and SHA-256 digests for at most three candidates. It does not load or select a model.

For a preloaded OpenAI-compatible local LLM server, set `LOCAL_LLM_URL` to its loopback
HTTP origin and `LOCAL_LLM_MODEL` to its advertised model name, then run:

```sh
bun run models:llm:run CANDIDATES.json CANDIDATE_ID CASES.json NEW_REPORT.json
```

The case file is an array of objects with distinct `id`, `prompt`, and `reviewedBy`
fields. The runner records two streamed responses and time to first text for each case.
Outputs are stored in the report and may contain sensitive prompt-derived content.
The first request is not a verified cold start: restart the server and record that
condition separately. The report does not verify loaded artifact identity, review
response quality, measure first audio or concurrent resources, or select a winner.

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

To compare up to three measured candidates after the laptop runs, use:

```sh
bun run models:select CANDIDATES.json CASES.json OBSERVATIONS.json NEW_REPORT.json
```

The observations file is version 1 and contains `kind`, `casesSha256`, `limits`, and
`observations`. Each observation names `candidateId`, `measuredAt`, `reviewer`,
`loadedArtifactDigestsVerifiedBy`, and a shared `configuration` describing the actual
concurrent ASR, TTS and optional retrieval setup. Its `cases` array records every case
`id`, `meaningCriticalErrors`, and `reviewedBy`. Its `metrics` object records
`asrLagP95Ms`, `coldFirstTokenMs`, `warmFirstTokenMs`, `firstAudioMs`, `peakRamBytes`,
`peakVramBytes`, and `peakCpuPercent`. `limits` uses those same metric names plus
`meaningCriticalErrors`. The case-file digest is SHA-256 of the exact JSON bytes.
Candidate artifacts are checked again, every candidate must have the same cases and
configuration, and the report records each exceeded limit. The ranking prefers fewer
meaning-critical errors, then warm first-token latency and ASR lag. A failed comparison
still writes a report with no selected candidate. Imported observations and human review
remain assertions by the named people, not independently validated by this command.
