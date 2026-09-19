// マイクの声にエフェクトをかけるチェーン。ブラウザ専用。
//   mic → input ┬→ analyser（音量の計測だけ）
//               ├→ dry ────────────────────────────┐
//               ├→ pitch（ワークレット）────────────┤
//               ├→ robot（リング変調 → 櫛形）───────┼→ timbreBus ┬→ voiceBus
//               └→ distortion（歪み）──────────────┘            └→ echo send → Delay ⟲ → voiceBus
// 4 本は常に並列で動かしておき、出口のゲインだけを入れ替える。つなぎ替えるより切替の音が途切れず、ディレイの中身も保たれる。

import { fadeTo, rampTo } from './ramp.js'
import { VOICE_FX, distortionDrive, distortionPostGain, echoFeedback, makeDistortionCurve, ratioFor, robotCarrierHz } from './voice-params.js'

const FADE_SEC = 0.07
/** パラメータを動かすときの時定数。段差で変えるとプチッと鳴る。 */
const GLIDE_SEC = 0.03
const SPEAK_RMS = 0.02
const SPEAK_HOLD_MS = 150
const METER_MS = 40

export function createVoice(engine) {
  /** on になっている id → intensity。Map は挿入順を保つので、後から on になったものほど後ろに並ぶ。 */
  const wanted = new Map()
  let graph = null
  let building = null
  let mic = null
  let loudAt = -Infinity

  async function build(ctx) {
    const input = ctx.createGain()
    // マイクがステレオでも 1ch に畳む。ワークレットが mono なので、他の経路もそろえておく
    input.channelCount = 1
    input.channelCountMode = 'explicit'
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    input.connect(analyser)
    // 録画用に、加工の手前の音も渡しておく
    if (engine.rawBus) input.connect(engine.rawBus)

    const timbreBus = ctx.createGain()
    const exit = (from, level) => {
      const gain = ctx.createGain()
      gain.gain.value = level
      from.connect(gain).connect(timbreBus)
      return gain
    }
    const paths = { dry: exit(input, 1) }

    // pitch: ワークレットが読めなくても、他の経路は動かす
    let ratio = null
    try {
      await ctx.audioWorklet.addModule(new URL('./pitch-worklet.js', import.meta.url))
      const mono = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' }
      const shifter = new AudioWorkletNode(ctx, 'pitch', mono)
      ratio = shifter.parameters.get('ratio')
      input.connect(shifter)
      paths.pitch = exit(shifter, 0)
    } catch (err) {
      console.warn('pitch worklet unavailable; pitch_up / pitch_down are disabled', err)
    }

    // robot: gain 0 の GainNode の gain に搬送波を差すと、入力 × 搬送波（リング変調）になる
    const fx = VOICE_FX.robot
    const ring = ctx.createGain()
    ring.gain.value = 0
    const carrier = ctx.createOscillator()
    carrier.frequency.value = robotCarrierHz(0.5)
    carrier.connect(ring.gain)
    carrier.start()
    const comb = ctx.createGain()
    const combDelay = ctx.createDelay(0.1)
    combDelay.delayTime.value = fx.combSec
    const combFeedback = ctx.createGain()
    combFeedback.gain.value = fx.combFeedback
    const robotHp = ctx.createBiquadFilter()
    robotHp.type = 'highpass'
    robotHp.frequency.value = fx.highpassHz
    input.connect(ring).connect(comb)
    comb.connect(combDelay).connect(combFeedback).connect(comb)
    comb.connect(robotHp)
    const robotLevel = ctx.createGain()
    robotLevel.gain.value = fx.level
    robotHp.connect(robotLevel)
    paths.robot = exit(robotLevel, 0)

    // distortion: 低域を先に切る。切らないと、息や机の振動が歪んで濁る。歪みで増えた高域は後ろで削り、声の芯（1.6k）を少し持ち上げる
    const dx = VOICE_FX.distortion
    const distHp = ctx.createBiquadFilter()
    distHp.type = 'highpass'
    distHp.frequency.value = dx.highpassHz
    const drive = ctx.createGain()
    drive.gain.value = distortionDrive(0.5)
    const shaper = ctx.createWaveShaper()
    shaper.curve = makeDistortionCurve(dx.curve)
    shaper.oversample = '4x'
    const distLp = ctx.createBiquadFilter()
    distLp.type = 'lowpass'
    distLp.frequency.value = dx.lowpassHz
    const presence = ctx.createBiquadFilter()
    presence.type = 'peaking'
    presence.frequency.value = dx.presenceHz
    presence.Q.value = 1
    presence.gain.value = dx.presenceDb
    const post = ctx.createGain()
    post.gain.value = distortionPostGain(distortionDrive(0.5))
    input.connect(distHp).connect(drive).connect(shaper).connect(distLp).connect(presence).connect(post)
    paths.distortion = exit(post, 0)

    // echo: send を開閉するだけ。閉じてもディレイの中の音は回り続けるので、余韻は自然に消える
    const ex = VOICE_FX.echo
    const send = ctx.createGain()
    send.gain.value = 0
    const delay = ctx.createDelay(1)
    delay.delayTime.value = ex.delaySec
    const damp = ctx.createBiquadFilter()
    damp.type = 'lowpass'
    damp.frequency.value = ex.dampHz
    const feedback = ctx.createGain()
    feedback.gain.value = echoFeedback(0.5)
    const wet = ctx.createGain()
    wet.gain.value = ex.wet
    timbreBus.connect(engine.voiceBus)
    timbreBus.connect(send).connect(delay)
    delay.connect(damp).connect(feedback).connect(delay)
    delay.connect(wet).connect(engine.voiceBus)

    return {
      ctx,
      input,
      analyser,
      buffer: new Float32Array(analyser.fftSize),
      paths,
      /** 各経路の出口をどちらへ向けたか（1 = 開、0 = 閉）。フェードの途中でも行き先で持つ。 */
      levels: { dry: 1, pitch: 0, robot: 0, distortion: 0 },
      echoOn: false,
      ratio,
      carrier,
      drive,
      post,
      send,
      feedback,
    }
  }

  const available = (id) => VOICE_FX[id].stage !== 'timbre' || Boolean(graph?.paths[VOICE_FX[id].path])

  /** 今かかっている timbre。排他なので、後から on になったものが勝つ。 */
  const winner = () => [...wanted.keys()].filter((id) => VOICE_FX[id].stage === 'timbre' && available(id)).at(-1) ?? null

  function glide(param, value, t, jump) {
    if (jump) param.setValueAtTime(value, t)
    else param.setTargetAtTime(value, t, GLIDE_SEC)
  }

  /** wanted をグラフに反映する。モニタが閉じていても行う（開けた瞬間に正しい声が出るように）。 */
  function apply() {
    if (!graph) return
    const t = graph.ctx.currentTime
    const id = winner()
    const path = id ? VOICE_FX[id].path : 'dry'
    // これから開く経路は今は鳴っていないので、パラメータを一気に置いてよい。鳴っている経路は滑らかに動かす
    const jump = graph.levels[path] === 0
    const intensity = wanted.get(id)
    if (path === 'pitch') glide(graph.ratio, ratioFor(id, intensity), t, jump)
    if (path === 'robot') glide(graph.carrier.frequency, robotCarrierHz(intensity), t, jump)
    if (path === 'distortion') {
      const drive = distortionDrive(intensity)
      glide(graph.drive.gain, drive, t, jump)
      glide(graph.post.gain, distortionPostGain(drive), t, jump)
    }
    for (const [name, gain] of Object.entries(graph.paths)) {
      const level = name === path ? 1 : 0
      if (graph.levels[name] === level) continue
      graph.levels[name] = level
      fadeTo(gain.gain, level === 1, t, FADE_SEC)
    }

    const echoOn = wanted.has('echo')
    if (echoOn) glide(graph.feedback.gain, echoFeedback(wanted.get('echo')), t, false)
    if (echoOn !== graph.echoOn) {
      graph.echoOn = echoOn
      rampTo(graph.send.gain, echoOn ? 1 : 0, t, FADE_SEC)
    }
  }

  function measure() {
    if (!graph) return 0
    graph.analyser.getFloatTimeDomainData(graph.buffer)
    let sum = 0
    for (const v of graph.buffer) sum += v * v
    const rms = Math.sqrt(sum / graph.buffer.length)
    if (rms > SPEAK_RMS) loudAt = performance.now()
    return rms
  }

  return {
    /** getUserMedia 済みの stream をつなぐ。つなげたら true。呼び直すとマイクだけ差し替える。 */
    async attach(stream) {
      const ctx = engine.ctx
      if (!ctx || !stream?.getAudioTracks?.().length) return false
      try {
        // 続けて 2 回呼ばれても、グラフは 1 つしか作らない
        building ??= build(ctx)
        const built = await building
        if (!graph) {
          graph = built
          // speaking() は「直近 150ms」を見るので、呼ばれたときだけ測ると間の声を取りこぼす
          setInterval(measure, METER_MS)
        }
        mic?.disconnect()
        // 変数に持っておく。参照が切れると Chrome が source を回収して無音になることがある
        mic = ctx.createMediaStreamSource(stream)
        mic.connect(graph.input)
        apply()
        return true
      } catch (err) {
        console.warn('voice chain failed to start', err)
        building = null
        return false
      }
    },

    /** マイクをつなぐ前に呼ばれたぶんは覚えておき、つないだときに反映する。 */
    set(id, on, intensity = 0.5) {
      if (!Object.hasOwn(VOICE_FX, id)) return
      // すでに on の id は強さだけ更新し、順番は動かさない。on の送り直しで勝ち負けが入れ替わらないようにする
      if (on) wanted.set(id, intensity)
      else wanted.delete(id)
      apply()
    },

    /** グラフに反映されている id。timbre は勝っている 1 つだけ。 */
    active() {
      if (!graph) return []
      const id = winner()
      return [...(id ? [id] : []), ...[...wanted.keys()].filter((key) => VOICE_FX[key].stage === 'space')]
    },

    level: () => Math.min(1, measure()),
    speaking() {
      measure()
      return performance.now() - loudAt < SPEAK_HOLD_MS
    },
    ready: () => Boolean(graph && mic),
  }
}
