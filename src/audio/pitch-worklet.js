// ピッチシフタの AudioWorklet。中身は pitch-core.js で、ここは音声スレッドとの受け渡しだけ。
// Chrome の AudioWorklet は module の静的 import に対応しているので、バンドルせずにそのまま読ませる。

import { createShifter } from './pitch-core.js'

class PitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' }]
  }

  constructor() {
    super()
    this.shifter = createShifter(sampleRate)
    this.silence = new Float32Array(128)
  }

  process(inputs, outputs, parameters) {
    const out = outputs[0]?.[0]
    if (!out) return true
    // 入力がつながっていないブロックには配列が来ない。無音を流し込み、リングに残った音が後から出てこないようにする
    if (this.silence.length !== out.length) this.silence = new Float32Array(out.length)
    this.shifter.process(inputs[0]?.[0] ?? this.silence, out, parameters.ratio[0])
    return true
  }
}

registerProcessor('pitch', PitchProcessor)
