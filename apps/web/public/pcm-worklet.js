/* global AudioWorkletProcessor, sampleRate, registerProcessor */
// AudioWorklet: 16 kHz mono PCM16, exactly 100 ms per posted frame. Audio is never played back.
class LevelheadPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.sourceIndex = 0
    this.nextOutputAt = 0
    this.previous = 0
    this.samples = new Int16Array(1600)
    this.count = 0
    this.paused = false
    this.closed = false
    this.port.onmessage = (event) => {
      if (event.data === 'stop') this.closed = true
      if (event.data === 'done') {
        if (this.count > 0) {
          this.samples.fill(0, this.count)
          const buffer = this.samples.buffer
          this.port.postMessage(buffer, [buffer])
          this.count = 0
        }
        this.port.postMessage({ kind: 'flushed' })
        this.closed = true
      }
      if (event.data === 'pause') this.paused = true
      if (event.data === 'resume') this.paused = false
    }
  }

  process(inputs) {
    if (this.closed) return false
    const channels = inputs[0]
    if (!channels?.length || this.paused) return true
    const left = channels[0]
    const right = channels[1]
    for (let i = 0; i < left.length; i += 1) {
      const sample = right ? (left[i] + right[i]) / 2 : left[i]
      while (this.nextOutputAt <= this.sourceIndex) {
        const fraction = Math.max(0, this.nextOutputAt - (this.sourceIndex - 1))
        const interpolated =
          this.sourceIndex === 0 ? sample : this.previous + (sample - this.previous) * fraction
        const limited = Math.max(-1, Math.min(1, interpolated))
        this.samples[this.count++] = Math.round(limited < 0 ? limited * 32768 : limited * 32767)
        if (this.count === 1600) {
          const buffer = this.samples.buffer
          this.port.postMessage(buffer, [buffer])
          this.samples = new Int16Array(1600)
          this.count = 0
        }
        this.nextOutputAt += sampleRate / 16000
      }
      this.previous = sample
      this.sourceIndex += 1
    }
    return true
  }
}

registerProcessor('levelhead-pcm-capture', LevelheadPcmCapture)
