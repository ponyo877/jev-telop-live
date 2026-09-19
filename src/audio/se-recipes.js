// SE の合成レシピ。差し替え用のサンプル（assets/se/）が無い id は、se-synth.js がこれを WebAudio のノードに組んで鳴らす。DOM にも WebAudio にも依存しない。
//   レシピ: { dur, voices }。voice は発音体 1 つ（オシレータかノイズ）と、その音量・周波数・フィルタの時間変化。
//   包絡: [[t, 値, ramp?], ...]。t は voice の start からの秒で昇順。ramp は前の点からの進み方で 'exp' か 'lin'。省略するとその時刻に値を置くだけ（段差）。
//   exp は 0 に届かないので、無音は SILENT で表す。フィルタを通したノイズは帯域の外のエネルギーを失ってずっと小さくなるので、ノイズの gain は 1 を超えてよい。乱数は固定の種から引き、同じ heat なら同じレシピになる。

import { mulberry32 } from './rng.js'

export const SILENT = 0.0001

const lerp = (a, b, t) => a + (b - a) * t
const hz = (note) => 440 * 2 ** ((note - 69) / 12)

/** voice が鳴り終わる時刻（レシピの先頭から）。音量の包絡の最後の点で止める。 */
export const voiceEnd = (voice) => (voice.start ?? 0) + voice.gain.at(-1)[0]

const recipe = (voices) => ({ dur: Math.max(...voices.map(voiceEnd)), voices })

/** 打撃の包絡。attack 秒で peak まで立ち上げ、そこから decay 秒で消える。 */
const hit = (peak, attack, decay) => [[0, SILENT], [attack, peak, 'exp'], [attack + decay, SILENT, 'exp']]

/** ゆっくり入って出る包絡。 */
const swell = (peak, fadeIn, hold, fadeOut) => [[0, SILENT], [fadeIn, peak, 'lin'], [fadeIn + hold, peak, 'lin'], [fadeIn + hold + fadeOut, SILENT, 'lin']]

/** 波打つ包絡。全体を山なりにふくらませ、その上に rate Hz のうねりを depth の深さで乗せる。 */
function wavy(peak, dur, rate, depth, phase = 0) {
  const n = Math.max(2, Math.round(dur / 0.05))
  const points = [[0, SILENT]]
  for (let i = 1; i < n; i++) {
    const t = (i * dur) / n
    const body = Math.sin((Math.PI * t) / dur) ** 0.6
    const wave = 1 - depth * (0.5 + 0.5 * Math.sin(2 * Math.PI * rate * t + phase))
    points.push([t, Math.max(SILENT, peak * body * wave), 'lin'])
  }
  points.push([dur, SILENT, 'lin'])
  return points
}

/** 不規則に開く短いゲート（パチパチ）。ランプは前の点から始まるので、開く直前に SILENT の点を置いて閉じたまま待たせる。 */
function crackle(rng, dur, peak, gapMax) {
  const points = [[0, SILENT]]
  let t = 0.02 + rng() * gapMax
  while (t + 0.012 < dur) {
    const len = 0.003 + 0.007 * rng()
    points.push([t, SILENT], [t + 0.001, peak * (0.3 + 0.7 * rng()), 'exp'], [t + 0.001 + len, SILENT, 'exp'])
    t += 0.011 + len + rng() * gapMax
  }
  return points
}

/** voice の組み立て。freq は数ならその高さで固定、配列なら包絡。 */
const osc = (type, freq, gain, rest) => ({ src: 'osc', type, freq: typeof freq === 'number' ? [[0, freq]] : freq, gain, ...rest })
const noise = (filter, gain, rest) => ({ src: 'noise', filter, gain, ...rest })
const lowpass = (freq, q) => ({ type: 'lowpass', freq, q })
const highpass = (freq, q) => ({ type: 'highpass', freq, q })
const bandpass = (freq, q) => ({ type: 'bandpass', freq, q })

const GAAN_NOTES = [36, 42, 49, 55, 56] // C2 / F#2 / C#3 / G3 / Ab3
const KIRAN_NOTES = [96, 100, 103, 108] // C7 / E7 / G7 / C8
const HA_PERIOD = 1 / 5.5
const HA_LEN = 0.09

export const RECIPES = {
  // 胴鳴り（下がる sine）+ 低いノイズの量感 + アタックの皮の音
  don: (heat) => {
    const decay = lerp(0.4, 0.75, heat)
    return recipe([
      osc('sine', [[0, lerp(150, 200, heat)], [0.16, 42, 'exp']], hit(0.8, 0.003, decay)),
      noise(lowpass(350), hit(1, 0.003, 0.22)),
      noise(bandpass(1800, 1.2), hit(0.9, 0.001, 0.04)),
    ])
  },

  // 半音と三全音でぶつかる和音を叩き、音程ごと沈ませる
  gaan: (heat) => {
    const decay = lerp(1.6, 2.4, heat)
    const detune = [[0, 0], [decay, -50, 'lin']]
    const filter = lowpass([[0, 2200], [decay, 600, 'exp']], 0.7)
    return recipe(
      GAAN_NOTES.flatMap((note, i) => [
        osc('triangle', hz(note), hit(0.3, 0.005, decay), { detune, filter, pan: (i - 2) * 0.2 }),
        osc('sine', hz(note) * 2, hit(0.1, 0.005, decay * 0.7), { detune, filter, pan: (i - 2) * 0.2 }),
      ]),
    )
  },

  // 人のざわめき。左右で違ううねり方をさせると、1 本のノイズではなく大勢に聞こえる
  zawa: (heat) => {
    const dur = lerp(2.2, 3, heat)
    const peak = lerp(1, 1.5, heat)
    return recipe([
      noise(bandpass([[0, 600], [dur * 0.5, 760, 'lin'], [dur, 560, 'lin']], 0.9), wavy(peak, dur, 1.7, 0.6), { pan: -0.4 }),
      noise(bandpass([[0, 720], [dur * 0.5, 600, 'lin'], [dur, 680, 'lin']], 1.1), wavy(peak, dur, 2.3, 0.6, 2), { pan: 0.4 }),
      noise(lowpass(220), wavy(peak * 1.5, dur, 0.9, 0.4, 1)),
    ])
  },

  // 駆け上がるベル。非整数倍音を混ぜると金属の音になる。最後の音だけ長く残す
  kiran: (heat) => {
    const tail = lerp(0.9, 1.5, heat)
    const bells = KIRAN_NOTES.flatMap((note, i) => {
      const decay = i === KIRAN_NOTES.length - 1 ? tail : 0.35
      const rest = { start: i * 0.045, pan: (i - 1.5) * 0.3 }
      return [osc('sine', hz(note), hit(0.3, 0.002, decay), rest), osc('sine', hz(note) * 2.76, hit(0.08, 0.002, decay * 0.4), rest)]
    })
    return recipe([...bells, noise(highpass(7000), hit(lerp(0.15, 0.3, heat), 0.01, 0.5))])
  },

  // ハリセン。紙の「パ」と、叩かれた側の低い「ン」
  slap: (heat) =>
    recipe([
      noise(bandpass(2500, 0.7), hit(lerp(1.5, 1.9, heat), 0.001, 0.015)),
      noise(bandpass(900, 1), hit(1.3, 0.001, lerp(0.07, 0.11, heat))),
      osc('triangle', [[0, 230], [0.06, 110, 'exp']], hit(0.5, 0.001, 0.07)),
    ]),

  // 観客の笑い。合成では声に聞こえにくいので、差し替え用のサンプルを置く前提の仮の音。
  // 1 人ぶんは、sawtooth の声帯を母音「ア」のフォルマント 2 つに通し、「ハ」を 5.5Hz で繰り返す。回を追うごとに低く小さくなる。
  laugh: (heat) => {
    const rng = mulberry32(0x1a06)
    const voices = []
    for (let v = 0; v < 5; v++) {
      const f0 = 110 + 150 * rng()
      const count = Math.min(8, 5 + Math.floor(heat * 3 + rng()))
      const start = v === 0 ? 0 : 0.03 + 0.2 * rng()
      const peak = lerp(1, 1.5, heat) * (0.8 + 0.4 * rng())
      const freq = []
      const gain = []
      for (let k = 0; k < count; k++) {
        const t = k * HA_PERIOD
        const f = f0 * 0.97 ** k
        freq.push([t, f * 1.08], [t + HA_LEN, f * 0.92, 'lin'])
        gain.push([t, SILENT], [t + 0.015, peak * 0.88 ** k, 'exp'], [t + HA_LEN, SILENT, 'exp'])
      }
      for (const formant of [800, 1200]) voices.push(osc('sawtooth', freq, gain, { filter: bandpass(formant, 3), pan: (v - 2) * 0.4, start }))
    }
    return recipe(voices)
  },

  // 滑り落ちて、最後に床で「ドス」
  zukoo: (heat) => {
    const fall = lerp(0.42, 0.58, heat)
    const slide = [[0, SILENT], [0.01, 0.45, 'exp'], [fall - 0.05, 0.35, 'lin'], [fall, SILENT, 'exp']]
    return recipe([
      osc('triangle', [[0, lerp(520, 700, heat)], [fall, 90, 'exp']], slide),
      osc('sine', [[0, 120], [0.12, 45, 'exp']], hit(0.85, 0.003, 0.3), { start: fall }),
      noise(lowpass(300), hit(1.2, 0.002, 0.12), { start: fall }),
    ])
  },

  // 「え、ええっ!?」。短い上がり調子のあとに、もっと高くまで上がる 2 音目
  eee: (heat) => {
    const top = lerp(800, 1000, heat)
    const held = (peak, release) => [[0, SILENT], [0.01, peak, 'exp'], [0.25, peak * 0.85, 'lin'], [release, SILENT, 'exp']]
    return recipe([
      osc('triangle', [[0, 300], [0.1, 560, 'exp']], [[0, SILENT], [0.008, 0.4, 'exp'], [0.09, 0.3, 'lin'], [0.12, SILENT, 'exp']]),
      osc('triangle', [[0, 340], [0.25, top, 'exp']], held(0.45, 0.42), { start: 0.15 }),
      osc('sine', [[0, 680], [0.25, top * 2, 'exp']], held(0.12, 0.38), { start: 0.15 }),
    ])
  },

  // すきま風。ノイズの地に、共鳴の鋭い帯域を上下させて「ヒュ〜」の音程を付ける
  wind: (heat) => {
    const dur = lerp(1.6, 2.1, heat)
    const whistle = bandpass([[0, 700], [dur * 0.4, 1300, 'exp'], [dur, 600, 'exp']], 9)
    return recipe([
      noise(highpass(1800), swell(0.3, dur * 0.4, dur * 0.15, dur * 0.45)),
      noise(whistle, swell(lerp(1.8, 2.5, heat), dur * 0.35, dur * 0.15, dur * 0.5)),
    ])
  },

  // おりん。わずかにずらした 2 本のうなりで、鳴り続ける金属の揺れを出す
  chiin: (heat) => {
    const decay = lerp(1.3, 2, heat)
    return recipe([
      osc('sine', 2093, hit(0.25, 0.002, decay), { pan: -0.15 }),
      osc('sine', 2095.6, hit(0.25, 0.002, decay), { pan: 0.15 }),
      osc('sine', 2093 * 2.71, hit(0.1, 0.001, decay * 0.3)),
      noise(bandpass(5000, 2), hit(0.5, 0.001, 0.02)),
    ])
  },

  // B5 → E6 の 2 音。2 音目の頭で音量を戻して打ち直す
  pikon: (heat) => {
    const decay = lerp(0.35, 0.6, heat)
    const gain = (peak) => [[0, SILENT], [0.004, peak, 'exp'], [0.086, peak * 0.5, 'exp'], [0.09, peak, 'lin'], [0.09 + decay, SILENT, 'exp']]
    return recipe([
      osc('triangle', [[0, hz(83)], [0.09, hz(88)]], gain(0.5)),
      osc('sine', [[0, hz(83) * 2], [0.09, hz(88) * 2]], gain(0.12)),
    ])
  },

  // 45Hz は小さいスピーカーでは鳴らないので、倍音のある sawtooth を低域だけ残して重ねる
  rumble: (heat) => {
    const dur = lerp(1.5, 2.4, heat)
    const rate = lerp(6, 9, heat)
    return recipe([
      noise(lowpass(120, 1), swell(2.5, 0.3, dur - 0.8, 0.5)),
      osc('sine', 45, wavy(0.5, dur, rate, 0.7)),
      osc('sawtooth', [[0, 45], [dur, 40, 'lin']], wavy(0.3, dur, rate, 0.7), { filter: lowpass(220) }),
    ])
  },

  // 「ドッ・クン」。熱量が高ければもう 1 拍
  heartbeat: (heat) => {
    const period = lerp(0.8, 0.62, heat)
    const thump = (start, peak) => [
      osc('sine', [[0, 60], [0.1, 40, 'exp']], hit(peak, 0.004, 0.15), { start }),
      osc('triangle', [[0, 120], [0.08, 80, 'exp']], hit(peak * 0.35, 0.004, 0.09), { start }),
      noise(lowpass(200), hit(peak * 1.2, 0.002, 0.05), { start }),
    ]
    const beats = heat >= 0.5 ? [0, period] : [0]
    return recipe(beats.flatMap((t) => [...thump(t, 0.95), ...thump(t + 0.22, 0.7)]))
  },

  // 高いところでパチパチはぜる音と、低いところで燃え続けるゴォ
  fire: (heat) => {
    const rng = mulberry32(0xf12e)
    const dur = 1.5
    const gap = lerp(0.09, 0.04, heat)
    return recipe([
      noise(bandpass(3200, 1.5), crackle(rng, dur, 2, gap), { pan: -0.5 }),
      noise(bandpass(4500, 2), crackle(rng, dur, 1.8, gap), { pan: 0.5 }),
      noise(bandpass(1800, 1), crackle(rng, dur, 1.5, gap * 1.5)),
      noise(lowpass(260), wavy(lerp(2, 3, heat), dur, 3.1, 0.5)),
      noise(bandpass(520, 0.6), wavy(0.4, dur, 4.3, 0.6, 1)),
    ])
  },

  // 拍手。1 発ずつ帯域・長さ・位置を変え、後ろへ行くほど小さくして人数が減っていく感じにする
  clap: (heat) => {
    const rng = mulberry32(0xc1a9)
    const count = Math.round(lerp(12, 30, heat))
    const spread = lerp(0.9, 1.6, heat)
    const voices = []
    for (let i = 0; i < count; i++) {
      const at = rng() * spread
      // 1 発目は必ず頭に置く。乱数だけで決めると、鳴り始めが遅れる回が出る
      const start = i === 0 ? 0 : at
      const peak = lerp(2.4, 3.6, heat) * (1 - (0.5 * start) / spread) * (0.6 + 0.4 * rng())
      voices.push(noise(bandpass(1200 + 1300 * rng(), 1.5), hit(peak, 0.001, 0.02 + 0.025 * rng()), { pan: rng() * 1.6 - 0.8, start }))
    }
    return recipe(voices)
  },
}

/** 熱量を 0..1 に丸めてレシピを引く。知らない id は null。 */
export function recipeFor(id, heat = 0.5) {
  if (!Object.hasOwn(RECIPES, id)) return null
  return RECIPES[id](Number.isFinite(heat) ? Math.min(1, Math.max(0, heat)) : 0.5)
}
