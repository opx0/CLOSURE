import {
  PERFORMANCE_BOUNDARY,
  type PerformanceDrill,
  type PerformanceNote,
  type SignalId,
} from '@levelhead/contracts'

// A complete record over SignalId, so a signal added to the registry fails to compile here until
// someone writes the instruction that would follow from it. Every instruction is direction-neutral,
// because a note fires above or below the baseline and the same instruction has to serve both.
export const DRILL_INSTRUCTIONS: Record<SignalId, string> = {
  articulation_rate:
    'Read your opening sentence aloud at the tempo you want, once, before the session starts, then answer the first three questions at that tempo.',
  speaking_rate:
    'Answer the next session’s first three questions in exactly three sentences each, so the gaps land between sentences rather than inside them.',
  unfilled_pause_rate:
    'Decide the shape of the whole answer before the first word: point, mechanism, trade-off. Pause once between the three and not inside them.',
  filled_pause_rate:
    'When a filler is about to arrive, close your mouth and wait. Silence is the substitute you are practising.',
  mid_clause_pause_ratio:
    'Finish the clause you started before you pause. If you need to think, stop at the comma and not before the verb.',
  hesitation_cluster_rate:
    'When you catch two hesitations in a row, stop the sentence and start it again from its first word.',
  repair_rate:
    'Say the one-sentence version of the answer in your head before you open your mouth, then speak that sentence first.',
  restart_rate:
    'Commit to the sentence you began. If it turns out to be the wrong sentence, finish it and correct it in the next one.',
  prolongation_rate: 'When you feel a word stretching, cut it short and pause instead.',
  discourse_marker_rate:
    'Before the session, write down the one filler phrase you reach for most and put the note on your monitor. Cut that phrase for the whole session.',
  pitch_range:
    'Say the claim, the mechanism and the conclusion of each answer at three different pitches: claim high, mechanism level, conclusion low.',
  pitch_variation:
    'Mark the one word in each sentence that carries the meaning and put the emphasis there.',
  terminal_rise_ratio: 'End every statement on a falling pitch. Only a question rises.',
  end_of_turn_loudness_drop:
    'Say the last sentence of an answer at the volume you said the first, and finish it before you look away from the camera.',
  response_latency:
    'Take a deliberate two-second pause after the question, then start. Count it rather than filling it.',
  time_to_first_content_word:
    'Start with the answer and not with a preamble. The first word out should be a noun or a verb from the question.',
  answer_duration: 'Give the answer in three points and stop. If they want more they will ask.',
  rate_drift_within_answer:
    'Plan the last sentence before you start, and say it at the tempo you opened with.',
  cadence_stability: 'Break each answer into three phrases and give each phrase one breath.',
  sentence_length_variation: 'Follow every long sentence with a short one.',
  interruption_recovery_time:
    'When you are cut off, take one breath, restate the new question in your own words, then answer it.',
  pre_answer_silence:
    'Decide your first sentence while the question is still being asked, and start on a silent beat rather than a filler.',
  rate_change_under_pressure:
    'When a question gets harder, say its first sentence slower than feels right, then continue at the tempo you opened the session with.',
  face_visible_ratio:
    'Put the camera where you can read the question without turning your head out of frame.',
  gaze_on_camera_ratio:
    'Move the window you read from so it sits directly under the lens, and answer to the lens.',
  head_pose_instability:
    'Set the camera at eye height and keep your back against the chair for a whole answer.',
  posture_shift_rate:
    'Sit forward with both feet on the floor before the first question and hold that position through each answer.',
  gesture_rate:
    'Rest your hands on the desk between answers and lift them only for the point you most want to land.',
  gesture_amplitude: 'Gesture inside the width of your shoulders so the movement stays in frame.',
  hands_out_of_frame_ratio:
    'Frame the shot from mid-chest up and keep your hands above the edge of the desk.',
  framing_headroom:
    'Raise or lower the camera until your eyes sit on the top third line of the frame.',
  framing_center_offset:
    'Centre yourself in the frame before the first question and check it once at the halfway point.',
  exposure_median:
    'Put your main light in front of you rather than behind, and raise it until your face reads as bright as the wall.',
  exposure_clipped_ratio:
    'Move or switch off the brightest light in the shot until nothing in the frame is pure white.',
}

export function drillsFor(notes: readonly PerformanceNote[]): PerformanceDrill[] {
  return notes.map((note) => ({
    noteId: note.id,
    signal: note.signal,
    instruction: DRILL_INSTRUCTIONS[note.signal],
    // For every signal in this registry the signal that raised the note is also the one that will
    // show whether the drill worked, because each instruction targets the thing its own signal
    // measures. The field stays separate from signal so a later drill that trades one signal for
    // another can say so without a schema change.
    retestSignal: note.signal,
    boundary: PERFORMANCE_BOUNDARY,
  }))
}
