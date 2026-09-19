// レシピ（se-recipes.js）を WebAudio のノードに組んで鳴らす。ブラウザ専用。
//   voice 1 つ: 発音体 → [フィルタ] → 音量の包絡 → [パン] → レシピ全体のゲイン → dest

import { SILENT, voiceEnd } from './se-recipes.js'

const NOISE_SEC = 2
/** 包絡の終点（SILENT）で止めるとわずかに段差が残るので、少しだけ余らせて止める。 */
const TAIL = 0.02

const noiseByCtx = new WeakMap()

/** 共有のホワイトノイズ。ctx ごとに 1 回だけ作る。 */
function noiseBuffer(ctx) {
  let buffer = noiseByCtx.get(ctx)
  if (!buffer) {
    buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * NOISE_SEC), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    noiseByCtx.set(ctx, buffer)
  }
  return buffer
}

/**
 * 包絡を AudioParam に書く。最初の点は必ず setValueAtTime で置く。置かないと、ランプが param の既定値から始まる。
 * exp は 0 以下を渡すと例外になる。cents のように 0 や負を取る値（positive = false）では lin に読み替える。
 */
function write(param, points, t0, positive = true) {
  points.forEach(([t, value, ramp], i) => {
    if (i === 0 || !ramp) param.setValueAtTime(value, t0 + t)
    else if (ramp === 'exp' && positive) param.exponentialRampToValueAtTime(Math.max(value, SILENT), t0 + t)
    else param.linearRampToValueAtTime(value, t0 + t)
  })
}

function source(ctx, voice, at) {
  if (voice.src === 'noise') {
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx)
    src.loop = true
    return src
  }
  const src = ctx.createOscillator()
  src.type = voice.type ?? 'sine'
  write(src.frequency, voice.freq ?? [[0, 440]], at)
  if (voice.detune) write(src.detune, voice.detune, at, false)
  return src
}

function filterNode(ctx, spec, at) {
  const filter = ctx.createBiquadFilter()
  filter.type = spec.type
  if (spec.q != null) filter.Q.value = spec.q
  if (Array.isArray(spec.freq)) write(filter.frequency, spec.freq, at)
  else filter.frequency.value = spec.freq
  return filter
}

/** レシピを時刻 t0（ctx.currentTime の時間軸）から鳴らす。stopAt は最後のノードが止まる時刻。 */
export function playRecipe(ctx, dest, recipe, t0, gain = 1) {
  const begin = Math.max(t0, ctx.currentTime)
  const out = ctx.createGain()
  out.gain.value = gain
  out.connect(dest)
  let alive = recipe.voices.length
  if (alive === 0) out.disconnect()

  for (const voice of recipe.voices) {
    const at = begin + (voice.start ?? 0)
    const src = source(ctx, voice, at)
    const nodes = [src]
    if (voice.filter) nodes.push(filterNode(ctx, voice.filter, at))
    const env = ctx.createGain()
    write(env.gain, voice.gain, at)
    nodes.push(env)
    if (voice.pan) {
      const panner = ctx.createStereoPanner()
      panner.pan.value = voice.pan
      nodes.push(panner)
    }
    // connect は接続先を返すので、順につないでいける
    nodes.reduce((from, to) => from.connect(to)).connect(out)

    // 止まったノードをつないだままにすると、グラフに残り続ける
    src.onended = () => {
      for (const node of nodes) node.disconnect()
      if (--alive === 0) out.disconnect()
    }
    // 同じノイズを複数の voice が頭から読むと、足したときに位相がそろって 1 本の大きなノイズになる。読み出し位置を散らす
    if (voice.src === 'noise') src.start(at, Math.random() * NOISE_SEC)
    else src.start(at)
    src.stop(begin + voiceEnd(voice) + TAIL)
  }
  return { stopAt: begin + recipe.dur + TAIL }
}
