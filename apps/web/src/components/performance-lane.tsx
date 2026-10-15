import type { Debrief } from '../api/client.ts'
import { words } from '../lib/format.ts'
import { Empty, Tag } from './primitives.tsx'

type PerformanceLane = Debrief['performance']
type Observation = PerformanceLane['observations'][number]
type Note = PerformanceLane['notes'][number]
type Drill = PerformanceLane['drills'][number]
type SignalId = Observation['signal']
type Family = Note['family']
type Unit = Observation['unit']

// The family each signal belongs to, so observations can be grouped the way the debrief promises.
// It mirrors the signal registry in `@levelhead/contracts`; the `Record<SignalId, Family>` type makes
// the compiler reject this file if a signal is ever added without being placed in a family here,
// rather than importing the whole contracts runtime into the browser for one lookup.
const FAMILY: Record<SignalId, Family> = {
  articulation_rate: 'speech',
  speaking_rate: 'speech',
  unfilled_pause_rate: 'speech',
  filled_pause_rate: 'speech',
  mid_clause_pause_ratio: 'speech',
  hesitation_cluster_rate: 'speech',
  repair_rate: 'speech',
  restart_rate: 'speech',
  prolongation_rate: 'speech',
  discourse_marker_rate: 'speech',
  pitch_range: 'speech',
  pitch_variation: 'speech',
  terminal_rise_ratio: 'speech',
  end_of_turn_loudness_drop: 'speech',
  response_latency: 'speech',
  time_to_first_content_word: 'speech',
  answer_duration: 'speech',
  rate_drift_within_answer: 'rhythm',
  cadence_stability: 'rhythm',
  sentence_length_variation: 'rhythm',
  interruption_recovery_time: 'rhythm',
  pre_answer_silence: 'rhythm',
  rate_change_under_pressure: 'rhythm',
  face_visible_ratio: 'kinematics',
  gaze_on_camera_ratio: 'kinematics',
  head_pose_instability: 'kinematics',
  posture_shift_rate: 'kinematics',
  gesture_rate: 'kinematics',
  gesture_amplitude: 'kinematics',
  hands_out_of_frame_ratio: 'kinematics',
  framing_headroom: 'kinematics',
  framing_center_offset: 'kinematics',
  exposure_median: 'kinematics',
  exposure_clipped_ratio: 'kinematics',
}

const FAMILY_ORDER: readonly Family[] = ['speech', 'rhythm', 'kinematics']
const FAMILY_LABEL: Record<Family, string> = {
  speech: 'Speech',
  rhythm: 'Rhythm',
  kinematics: 'Body (kinematics)',
}
const FAMILY_GLYPH: Record<Family, string> = {
  speech: '🗣',
  rhythm: '♪',
  kinematics: '🎥',
}

export function formatValue(value: number, unit: Unit): string {
  switch (unit) {
    case 'words_per_minute':
      return `${value.toFixed(0)} wpm`
    case 'milliseconds':
      return `${value.toFixed(0)} ms`
    case 'per_minute':
      return `${value.toFixed(1)} per min`
    case 'per_hundred_words':
      return `${value.toFixed(1)} per 100 words`
    case 'semitones':
      return `${value.toFixed(1)} st`
    case 'decibels':
      return `${value.toFixed(1)} dB`
    case 'degrees_squared':
      return `${value.toFixed(1)} deg²`
    case 'ratio':
      return value.toFixed(2)
  }
}

// A note carries no unit of its own, so its numbers are shown raw. The comparison basis is the
// point: a baseline with its n, a within-session contrast, or a cited reference band.
function triggerLine(note: Note): string {
  const trigger = note.trigger
  if (trigger.kind === 'baseline_drift') {
    const b = trigger.baseline
    return `observed ${trigger.observed.toFixed(2)} — ${trigger.direction} your own baseline (median ${b.median.toFixed(2)}, p25–p75 ${b.p25.toFixed(2)}–${b.p75.toFixed(2)}, n=${b.n})`
  }
  if (trigger.kind === 'within_session_contrast') {
    return `${words(trigger.contrast)}: ${trigger.earlier.toFixed(2)} then ${trigger.later.toFixed(2)} (ratio ${trigger.ratio.toFixed(2)})`
  }
  return `observed ${trigger.observed.toFixed(2)} against band ${trigger.low.toFixed(2)}–${trigger.high.toFixed(2)} (${trigger.source})`
}

function StatTile({ observation }: { observation: Observation }) {
  const [big, ...rest] = formatValue(observation.value, observation.unit).split(' ')
  return (
    <div className="rounded-xl border border-edge bg-white/[0.02] px-3.5 py-3 transition-colors hover:border-edge-strong">
      <p className="truncate text-[11px] text-quiet" title={words(observation.signal)}>
        {words(observation.signal)}
      </p>
      <p className="mono mt-1 text-lg font-semibold tracking-tight text-body">
        {big}
        {rest.length > 0 && (
          <span className="ml-1 text-[11px] font-normal text-quiet">{rest.join(' ')}</span>
        )}
      </p>
    </div>
  )
}

function NoteCard({ note }: { note: Note }) {
  return (
    <article className="rounded-xl border border-shaky/30 bg-shaky/[0.06] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="shaky">{words(note.signal)}</Tag>
        <Tag>{words(note.family)}</Tag>
      </div>
      <p className="mt-2.5 text-[14px] leading-relaxed text-body">{note.summary}</p>
      <p className="mono mt-1.5 text-[12px] text-quiet">{triggerLine(note)}</p>
      <p className="mt-1 text-[11px] text-quiet">
        backed by {note.observationAttemptIds.length} observation
        {note.observationAttemptIds.length === 1 ? '' : 's'}
      </p>
    </article>
  )
}

function DrillRow({ drill }: { drill: Drill }) {
  return (
    <li className="flex gap-3 rounded-xl border border-edge bg-white/[0.02] p-4">
      <span className="mt-0.5 text-accent-soft" aria-hidden>
        →
      </span>
      <div>
        <p className="text-[14px] leading-relaxed text-body">{drill.instruction}</p>
        <p className="mt-1 text-[11px] text-quiet">
          {words(drill.signal)} · retested next session via {words(drill.retestSignal)}
        </p>
      </div>
    </li>
  )
}

export function PerformanceLaneView({ lane }: { lane: PerformanceLane }) {
  const byFamily = (family: Family) => lane.observations.filter((o) => FAMILY[o.signal] === family)

  return (
    <div className="space-y-4">
      {lane.observations.length === 0 ? (
        <Empty>
          Nothing recorded into the performance lane for this session yet — practice an answer aloud
          in the studio to capture it.
        </Empty>
      ) : (
        <div className="space-y-4">
          {FAMILY_ORDER.map((family) => {
            const rows = byFamily(family)
            if (rows.length === 0) return null
            return (
              <div key={family}>
                <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-body">
                  <span aria-hidden>{FAMILY_GLYPH[family]}</span>
                  {FAMILY_LABEL[family]}
                  <span className="text-[11px] font-normal text-quiet">· {rows.length}</span>
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {rows.map((observation, index) => (
                    <StatTile key={`${observation.signal}-${index}`} observation={observation} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {lane.notes.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm text-shaky">Notes</h3>
          <div className="space-y-2">
            {lane.notes.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </div>
        </div>
      )}

      {lane.drills.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm text-body">Drills</h3>
          <ul className="space-y-2">
            {lane.drills.map((drill) => (
              <DrillRow key={drill.noteId} drill={drill} />
            ))}
          </ul>
        </div>
      )}

      {lane.signalsWithoutBaseline > 0 && (
        <p className="rounded-xl border border-edge bg-white/[0.02] px-4 py-3 text-[12px] leading-relaxed text-quiet">
          {lane.baselines.length === 0
            ? `This session establishes your baseline for ${lane.signalsWithoutBaseline} signal${lane.signalsWithoutBaseline === 1 ? '' : 's'}. A note needs a past distribution to compare against, so there is nothing to flag yet — only numbers to remember.`
            : `${lane.signalsWithoutBaseline} signal${lane.signalsWithoutBaseline === 1 ? '' : 's'} have no baseline yet, so they are shown as measured, not compared.`}
        </p>
      )}
    </div>
  )
}
