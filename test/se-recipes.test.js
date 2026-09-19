import test from 'node:test'
import assert from 'node:assert'
import { SE_IDS } from '../src/effects.js'
import { RECIPES, SILENT, recipeFor, voiceEnd } from '../src/audio/se-recipes.js'

const HEATS = [0, 0.25, 0.5, 0.75, 1]
const OSC_TYPES = ['sine', 'triangle', 'sawtooth', 'square']
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'peaking', 'notch', 'lowshelf', 'highshelf', 'allpass']

const each = (fn) => {
  for (const id of SE_IDS) for (const heat of HEATS) fn(recipeFor(id, heat), `${id} @ heat ${heat}`)
}

/**
 * WebAudio に書いて壊れない包絡か。
 *   時刻は 0 以上の昇順 / 値は有限 / exp ランプは両端とも 0 より大きい（0 をまたぐと、終点まで値が動かず最後に跳ぶ）
 */
function checkEnvelope(points, label, { positive = true } = {}) {
  assert.ok(Array.isArray(points) && points.length > 0, `${label}: 点が無い`)
  points.forEach(([t, value, ramp], i) => {
    assert.ok(Number.isFinite(t) && t >= 0, `${label}[${i}]: 時刻 ${t}`)
    assert.ok(Number.isFinite(value), `${label}[${i}]: 値 ${value}`)
    assert.ok([undefined, 'exp', 'lin'].includes(ramp), `${label}[${i}]: ramp ${ramp}`)
    if (positive) assert.ok(value >= 0, `${label}[${i}]: 負の値 ${value}`)
    if (i === 0) return
    assert.ok(t > points[i - 1][0], `${label}[${i}]: 時刻が昇順でない（${points[i - 1][0]} → ${t}）`)
    if (ramp === 'exp') {
      assert.ok(value >= SILENT, `${label}[${i}]: exp の終点が ${value}`)
      assert.ok(points[i - 1][1] >= SILENT, `${label}[${i}]: exp の始点が ${points[i - 1][1]}`)
    }
  })
}

test('閉集合の SE はすべてレシピを持ち、レシピに余計な id は無い', () => {
  assert.deepStrictEqual(Object.keys(RECIPES).sort(), [...SE_IDS].sort())
  assert.strictEqual(recipeFor('nope'), null)
  assert.strictEqual(recipeFor('toString'), null, 'Object の持ち物を id と取り違えない')
})

test('どの熱量でも、レシピは 4 秒以内で、voice は決めた形をしている', () => {
  each((recipe, label) => {
    assert.ok(recipe.dur > 0 && recipe.dur <= 4, `${label}: dur ${recipe.dur}`)
    assert.ok(recipe.voices.length > 0 && recipe.voices.length <= 40, `${label}: voice ${recipe.voices.length} 本`)
    recipe.voices.forEach((voice, i) => {
      const at = `${label} voice ${i}`
      assert.ok(['osc', 'noise'].includes(voice.src), `${at}: src ${voice.src}`)
      if (voice.src === 'osc') assert.ok(OSC_TYPES.includes(voice.type), `${at}: type ${voice.type}`)
      assert.ok(voice.start === undefined || (Number.isFinite(voice.start) && voice.start >= 0), `${at}: start ${voice.start}`)
      assert.ok(voice.pan === undefined || Math.abs(voice.pan) <= 1, `${at}: pan ${voice.pan}`)
      if (voice.filter) {
        assert.ok(FILTER_TYPES.includes(voice.filter.type), `${at}: filter ${voice.filter.type}`)
        assert.ok(voice.filter.q === undefined || voice.filter.q > 0, `${at}: q ${voice.filter.q}`)
      }
    })
  })
})

test('包絡は時刻が昇順で、exp ランプは 0 に触れない', () => {
  each((recipe, label) => {
    recipe.voices.forEach((voice, i) => {
      const at = `${label} voice ${i}`
      checkEnvelope(voice.gain, `${at} gain`)
      if (voice.src === 'osc') {
        checkEnvelope(voice.freq, `${at} freq`)
        for (const [, hz] of voice.freq) assert.ok(hz >= 20 && hz <= 20000, `${at}: ${hz} Hz`)
      }
      if (voice.detune) checkEnvelope(voice.detune, `${at} detune`, { positive: false })
      if (Array.isArray(voice.filter?.freq)) checkEnvelope(voice.filter.freq, `${at} filter`)
      else if (voice.filter) assert.ok(voice.filter.freq >= 20 && voice.filter.freq <= 20000, `${at}: filter ${voice.filter.freq} Hz`)
    })
  })
})

test('音量の包絡は無音で始まって無音で終わり、どの包絡も dur を超えない', () => {
  each((recipe, label) => {
    recipe.voices.forEach((voice, i) => {
      const at = `${label} voice ${i}`
      assert.ok(voice.gain[0][1] <= SILENT, `${at}: いきなり ${voice.gain[0][1]} で始まるとプチッと鳴る`)
      assert.ok(voice.gain.at(-1)[1] <= SILENT, `${at}: ${voice.gain.at(-1)[1]} のまま止めるとプチッと鳴る`)
      assert.ok(voiceEnd(voice) <= recipe.dur + 1e-9, `${at}: ${voiceEnd(voice)} > dur ${recipe.dur}`)
      const start = voice.start ?? 0
      for (const points of [voice.freq, voice.detune, voice.filter?.freq].filter(Array.isArray)) {
        assert.ok(start + points.at(-1)[0] <= recipe.dur + 1e-9, `${at}: 音が止まったあとまで包絡が続いている`)
      }
    })
    assert.ok(Math.abs(Math.max(...recipe.voices.map(voiceEnd)) - recipe.dur) < 1e-9, `${label}: dur が最後の voice とずれている`)
    assert.ok(recipe.voices.some((voice) => (voice.start ?? 0) === 0), `${label}: 頭から鳴る voice が無い`)
  })
})

test('同じ熱量なら同じレシピになる。熱量が範囲の外や数でなくても壊れない', () => {
  for (const id of SE_IDS) {
    for (const heat of HEATS) assert.deepStrictEqual(recipeFor(id, heat), recipeFor(id, heat), id)
    assert.deepStrictEqual(recipeFor(id, -3), recipeFor(id, 0), id)
    assert.deepStrictEqual(recipeFor(id, 7), recipeFor(id, 1), id)
    assert.deepStrictEqual(recipeFor(id, NaN), recipeFor(id, 0.5), id)
    assert.deepStrictEqual(recipeFor(id), recipeFor(id, 0.5), id)
  }
})

test('熱量で鳴り方が変わる', () => {
  assert.ok(recipeFor('don', 1).dur > recipeFor('don', 0).dur, 'ドンは長く響く')
  assert.ok(recipeFor('don', 1).voices[0].freq[0][1] > recipeFor('don', 0).voices[0].freq[0][1], 'ドンは高いところから落ちる')
  assert.ok(recipeFor('clap', 1).voices.length > recipeFor('clap', 0).voices.length, '拍手は人数が増える')
  assert.deepStrictEqual([recipeFor('clap', 0).voices.length, recipeFor('clap', 1).voices.length], [12, 30])
  assert.ok(recipeFor('heartbeat', 1).voices.length > recipeFor('heartbeat', 0).voices.length, '鼓動はもう 1 拍打つ')
})
