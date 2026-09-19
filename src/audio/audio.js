// 音まわりの窓口。外からはここだけを使う。何を鳴らすか・どの声にするかは呼び出し側が決め、この層は言われたとおりに鳴らすだけ。
// AudioContext はユーザー操作の中でしか始められないので、resume() より前に呼ばれたものは例外を出さずに流す（手動発火のボタンが先に押されることがある）。

import { createEngine } from './engine.js'
import { createSe } from './se.js'
import { createVoice } from './voice.js'

export function createAudio() {
  const engine = createEngine()
  const se = createSe(engine)
  const voice = createVoice(engine)
  /** resume より前に頼まれたサンプル。デコードには ctx が要るので、始まるまで持っておく。 */
  let pendingFiles = null

  return {
    /** 開始ボタンのハンドラの同期部分で呼ぶ。 */
    resume() {
      const ok = engine.resume()
      if (ok && pendingFiles) {
        se.load(pendingFiles)
        pendingFiles = null
      }
      return ok
    },

    /** getUserMedia 済みの stream に声のチェーンをつなぐ。成功なら true。 */
    openMic: (stream) => voice.attach(stream),

    async loadSamples(files = []) {
      if (engine.ctx) return se.load(files)
      pendingFiles = [...(pendingFiles ?? []), ...files]
      return 0
    },

    playSe: (id, options) => se.play(id, options),
    setVoice: (id, on, intensity) => voice.set(id, on, intensity),
    setMonitor: (on) => engine.setMonitor(on),
    setSeVolume: (v) => engine.setSeVolume(v),
    setSink: (deviceId) => engine.setSink(deviceId),
    /** 録画に入れる音（SE と声）。resume するまでは null。 */
    recordingStream: () => engine.tapStream,
    setRecordingVoice: (mode) => engine.setTapVoice(mode),
    level: () => voice.level(),
    speaking: () => voice.speaking(),

    state: () => ({
      running: engine.ctx?.state === 'running',
      mic: voice.ready(),
      voices: voice.active(),
      monitor: engine.monitor(),
      latencyMs: engine.latencyMs(),
      seBusyUntil: se.busyUntil(),
    }),
  }
}
