// AudioContext と出口までの配線。SE と声はそれぞれのバスに流し込むだけでよい。ブラウザ専用（resume するまでは何にも触れない）。
//   seBus ─────────────────┐
//   voiceBus → monitorGain ─┴→ master → コンプレッサ → スピーカー
// 録画に入れる音は、スピーカーとは別の出口（tap）に混ぜる。声をスピーカーに出していなくても、録画には入れたいので。
//   seBus ──────────────────┐
//   voiceBus → tapVoice ────┼→ コンプレッサ → tap（MediaStream）
//   rawBus（生のマイク）→ tapRaw ┘

import { rampTo } from './ramp.js'

const MONITOR_RAMP_SEC = 0.05

export function createEngine() {
  let ctx = null
  let nodes = null
  // resume より前に届いた設定は覚えておき、配線を作るときに反映する
  let monitorOn = false
  let seVolume = 1
  let sinkId = null
  let tapVoiceMode = 'processed'

  function build() {
    const seBus = ctx.createGain()
    const voiceBus = ctx.createGain()
    const monitorGain = ctx.createGain()
    const master = ctx.createGain()
    const limiter = ctx.createDynamicsCompressor()
    seBus.gain.value = seVolume
    monitorGain.gain.value = monitorOn ? 1 : 0
    // SE が重なったときの割れ止め。knee が既定の 30 だと 0dBFS 付近がほとんど潰れないので、0 にしてしきい値から上を頭打ちにする。
    // Chrome は設定から決まる補正ゲイン（この設定で +3dB ほど）を自動で掛けるので、全体がそのぶん大きくなる
    limiter.threshold.value = -6
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.003
    limiter.release.value = 0.15
    seBus.connect(master)
    voiceBus.connect(monitorGain).connect(master)
    master.connect(limiter).connect(ctx.destination)

    // 録画用の出口。SE は音量のスライダーを通ったあとを取るので、聞こえているとおりの大きさで録れる
    const rawBus = ctx.createGain()
    const tapVoice = ctx.createGain()
    const tapRaw = ctx.createGain()
    const tapLimiter = ctx.createDynamicsCompressor()
    tapLimiter.threshold.value = -6
    tapLimiter.knee.value = 0
    tapLimiter.ratio.value = 20
    tapLimiter.attack.value = 0.003
    tapLimiter.release.value = 0.15
    const tap = ctx.createMediaStreamDestination()
    seBus.connect(tapLimiter)
    voiceBus.connect(tapVoice).connect(tapLimiter)
    rawBus.connect(tapRaw).connect(tapLimiter)
    tapLimiter.connect(tap)
    nodes = { seBus, voiceBus, monitorGain, master, rawBus, tapVoice, tapRaw, tap }
    applyTapVoice()
  }

  function applyTapVoice() {
    if (!nodes) return
    rampTo(nodes.tapVoice.gain, tapVoiceMode === 'processed' ? 1 : 0, ctx.currentTime, MONITOR_RAMP_SEC)
    rampTo(nodes.tapRaw.gain, tapVoiceMode === 'raw' ? 1 : 0, ctx.currentTime, MONITOR_RAMP_SEC)
  }

  async function applySink() {
    if (!ctx?.setSinkId || sinkId == null) return false
    try {
      await ctx.setSinkId(sinkId)
      return true
    } catch {
      return false
    }
  }

  return {
    /** resume するまでは null。 */
    get ctx() {
      return ctx
    },
    get seBus() {
      return nodes?.seBus ?? null
    },
    get voiceBus() {
      return nodes?.voiceBus ?? null
    },
    get master() {
      return nodes?.master ?? null
    },
    /** 生のマイクの音を流し込む先。声のチェーンが、加工の手前の音をここへつなぐ。 */
    get rawBus() {
      return nodes?.rawBus ?? null
    },

    /** 録画に入れる音。SE と声を混ぜた MediaStream。resume するまでは null。 */
    get tapStream() {
      return nodes?.tap.stream ?? null
    },

    /**
     * 録画に入れる声。processed は声色の効果を通った声（効果が無いあいだは素通しなので、ふだんは生の声と同じ）、raw は生のマイク、none は声なし。
     * スピーカーへの出力（setMonitor）とは無関係。
     */
    setTapVoice(mode) {
      tapVoiceMode = ['processed', 'raw', 'none'].includes(mode) ? mode : tapVoiceMode
      applyTapVoice()
    },

    /** ユーザー操作のハンドラの同期部分で呼ぶ。await をはさむと操作の文脈が切れ、Chrome が再生を許さない。 */
    resume() {
      if (!ctx) {
        const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext
        if (!Ctor) return false
        ctx = new Ctor({ latencyHint: 'interactive' })
        build()
        applySink()
      }
      if (ctx.state !== 'running') ctx.resume().catch(() => {})
      return true
    },

    /**
     * 加工した自分の声をスピーカーに出すかどうか。既定は OFF。
     * スピーカーで開けるとマイクが拾って回り、ハウリングする。開けるのはイヤホンのときだけ。閉じていても声のグラフは動いていて、音量の計測には影響しない。
     */
    setMonitor(on) {
      monitorOn = Boolean(on)
      if (nodes) rampTo(nodes.monitorGain.gain, monitorOn ? 1 : 0, ctx.currentTime, MONITOR_RAMP_SEC)
    },
    monitor: () => monitorOn,

    setSeVolume(v) {
      seVolume = Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : seVolume
      if (nodes) rampTo(nodes.seBus.gain, seVolume, ctx.currentTime, MONITOR_RAMP_SEC)
    },

    /** 出力先を替える。setSinkId の無いブラウザでは何もしない。 */
    async setSink(deviceId) {
      sinkId = deviceId
      return applySink()
    },

    /** 出力側の遅れ。マイク側の遅れは含まない。 */
    latencyMs: () => (ctx ? Math.round(((ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0)) * 1000) : 0),
  }
}
