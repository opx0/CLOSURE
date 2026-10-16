"""Acoustic measurement for Levelhead's performance lane: pitch, loudness and terminal contour,
read off the waveform with Praat via parselmouth.

This module measures only. No function here decides what a number means about the person who
produced it; that reading, if anyone makes one, happens somewhere else and under its own name.
"""

import numpy as np
import parselmouth

# Praat's own analysis defaults for a human voice, taken as-is so a number this module reports can
# be reproduced by opening the same WAV in Praat rather than being a threshold tuned here.
PITCH_FLOOR_HZ = 75.0
PITCH_CEILING_HZ = 600.0

# The last fraction of a sentence is where a terminal contour lives, and the last frames of a turn
# are where a trailing-off drop shows up.
TERMINAL_WINDOW_S = 0.20
TAIL_FRACTION = 0.15

# A measurement threshold, not a finding. 1.5 semitones sits above the frame-to-frame jitter of a
# Praat pitch track, so a track that merely wobbles is not reported as a rise. It says nothing about
# what the speaker meant by it.
RISE_SEMITONES = 1.5


def _voiced(wav_path: str):
    try:
        sound = parselmouth.Sound(wav_path)
        pitch = sound.to_pitch(pitch_floor=PITCH_FLOOR_HZ, pitch_ceiling=PITCH_CEILING_HZ)
    except (parselmouth.PraatError, ValueError):
        # Audio shorter than the analysis window makes Praat raise instead of returning an empty
        # track, and a caller measuring a half-second clip should get zeros, not a 500.
        return None, np.empty(0, dtype=float), np.empty(0, dtype=float)
    return sound, pitch.xs(), pitch.selected_array["frequency"]


def pitch_track(wav_path: str) -> dict:
    _, _, freqs = _voiced(wav_path)
    # Parselmouth reports 0.0 Hz for an unvoiced frame, so `> 0` is the voiced mask.
    voiced = freqs[freqs > 0]
    if voiced.size == 0:
        return {
            "medianHz": 0.0,
            "p10Hz": 0.0,
            "p90Hz": 0.0,
            "rangeSemitones": 0.0,
            "coefficientOfVariation": 0.0,
        }

    p10, p90 = (float(value) for value in np.percentile(voiced, [10, 90]))
    mean = float(np.mean(voiced))
    return {
        "medianHz": float(np.median(voiced)),
        "p10Hz": p10,
        "p90Hz": p90,
        # p10 to p90 rather than min to max because the extremes of a pitch track are exactly where
        # its octave errors land, so the robust pair is the honest range.
        "rangeSemitones": float(12 * np.log2(p90 / p10)) if p10 > 0 else 0.0,
        "coefficientOfVariation": float(np.std(voiced) / mean) if mean > 0 else 0.0,
    }


def intensity_track(wav_path: str) -> dict:
    silent = {"medianDb": 0.0, "endOfTurnDropDb": 0.0}
    sound, times, freqs = _voiced(wav_path)
    if sound is None:
        return silent

    voiced_times = times[freqs > 0]
    if voiced_times.size == 0:
        return silent

    try:
        intensity = sound.to_intensity(minimum_pitch=PITCH_FLOOR_HZ)
    except (parselmouth.PraatError, ValueError):
        # Praat's intensity window is longer than its pitch window, so a clip can carry a usable
        # pitch track and still be too short for this one.
        return silent

    # Sampled at the voiced frame times so loudness and pitch describe the same frames. get_value
    # returns NaN outside the intensity object's own time domain, which is shorter than the sound.
    sampled = np.array([intensity.get_value(time=t) for t in voiced_times], dtype=float)
    sampled = sampled[np.isfinite(sampled)]
    if sampled.size == 0:
        return silent

    median_db = float(np.median(sampled))
    tail = sampled[-max(1, int(sampled.size * TAIL_FRACTION)) :]
    return {"medianDb": median_db, "endOfTurnDropDb": float(np.median(tail)) - median_db}


def terminal_contours(wav_path: str, sentence_spans) -> list[bool]:
    _, times, freqs = _voiced(wav_path)
    voiced = freqs > 0
    times, freqs = times[voiced], freqs[voiced]

    contours = []
    for start_s, end_s in sentence_spans:
        window = (times >= max(start_s, end_s - TERMINAL_WINDOW_S)) & (times <= end_s)
        tail = freqs[window]
        # One frame cannot go anywhere, and a span outside the recording selects none at all.
        if tail.size < 2:
            contours.append(False)
            continue
        half = tail.size // 2
        opening = float(np.median(tail[:half]))
        closing = float(np.median(tail[half:]))
        contours.append(bool(opening > 0 and 12 * np.log2(closing / opening) >= RISE_SEMITONES))
    return contours
