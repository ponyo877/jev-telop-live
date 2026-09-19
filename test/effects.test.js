import test from 'node:test'
import assert from 'node:assert'
import { CUES, CUE_IDS, FX, LAYERS, MOODS, MOOD_IDS, SE_IDS, SHADES, STYLES, STYLE_IDS, expandCue, expandMood } from '../src/effects.js'
import { SHADE_IDS } from '../src/stage/face-sprites.js'
import { validate } from '../src/bus.js'

test('id は重複せず、none が先頭で、束は空', () => {
  for (const ids of [CUE_IDS, MOOD_IDS, STYLE_IDS, SE_IDS]) assert.strictEqual(new Set(ids).size, ids.length)
  assert.strictEqual(CUE_IDS[0], 'none')
  assert.strictEqual(MOOD_IDS[0], 'none')
  assert.deepStrictEqual(expandCue('none', 1), { giongo: null, fx: null, se: null })
  assert.deepStrictEqual(expandMood('none'), [])
  assert.ok(!STYLE_IDS.includes('none'), '発話テロップの様式に none は無い')
})

test('束が指す効果は、すべて閉集合にある', () => {
  for (const cue of CUES.slice(1)) {
    assert.strictEqual(cue.giongo.length, 3, cue.id)
    assert.ok(cue.fx == null || FX.includes(cue.fx), cue.id)
    assert.ok(SE_IDS.includes(cue.se), cue.id)
  }
  for (const style of STYLES) assert.ok(style.se == null || SE_IDS.includes(style.se), style.id)
  for (const mood of MOODS) {
    for (const [layer, ids] of Object.entries(mood.layers)) for (const id of ids) assert.ok(LAYERS[layer].includes(id), `${mood.id}: ${layer}/${id}`)
  }
})

test('Jev に送る criteria は英語の説明文で、すべての行にある', () => {
  for (const row of [...CUES, ...MOODS, ...STYLES]) assert.match(row.criteria, /[a-z]{4,}.*\./, row.id)
})

test('cue は熱量で擬音の強さを変え、画面効果は熱量が足りるときだけ付ける', () => {
  assert.deepStrictEqual(expandCue('don', 0.2), { giongo: 'ドン', fx: null, se: 'don' })
  assert.deepStrictEqual(expandCue('don', 0.5), { giongo: 'ドン!', fx: 'focus', se: 'don' })
  assert.deepStrictEqual(expandCue('don', 0.9), { giongo: 'ドドン!!', fx: 'focus', se: 'don' })
  assert.deepStrictEqual(expandCue('zawa', 0.9).fx, null)
  assert.deepStrictEqual(expandCue('unknown', 0.9), { giongo: null, fx: null, se: null })
})

test('mood はレイヤーの列に展開される', () => {
  assert.deepStrictEqual(expandMood('cool'), [{ layer: 'shades', id: 'gold' }, { layer: 'voice', id: 'pitch_down' }])
})

test('サングラスは常に掛けているので、ムードの束には入れない。ムードはレンズの色を 1 つずつ、重ならないように持つ', () => {
  const colors = MOODS.slice(1).map((mood) => {
    assert.ok(!mood.layers.face?.includes('sunglasses'), mood.id)
    assert.strictEqual(mood.layers.shades?.length, 1, mood.id)
    return mood.layers.shades[0]
  })
  assert.strictEqual(new Set(colors).size, colors.length, 'ムードごとに違う色')
  assert.deepStrictEqual([...SHADE_IDS].sort(), [...SHADES].sort(), '閉集合のすべての色に、レンズの見た目がある')
})

test('閉集合に無いイベントと、古すぎる瞬発イベントは弾く', () => {
  const ok = { kind: 'oneshot', at: 1000, cue: 'don', telop: null }
  assert.strictEqual(validate(ok, 1500), null)
  assert.strictEqual(validate(ok, 3000), 'stale')
  assert.match(validate({ ...ok, cue: 'nope' }, 1000), /unknown cue/)
  assert.match(validate({ ...ok, cue: null, telop: { text: 'a', style: 'nope' } }, 1000), /unknown style/)
  assert.strictEqual(validate({ ...ok, cue: null }, 1000), 'empty oneshot')
  assert.strictEqual(validate({ kind: 'ambient', at: 0, layer: 'screen', id: 'rain', on: true }, 99999), null, '持続系は古くても通す')
  assert.match(validate({ kind: 'ambient', layer: 'screen', id: 'sunglasses', on: true }, 0), /unknown ambient/)
  assert.strictEqual(validate({ kind: 'ambient', at: 0, layer: 'shades', id: 'rainbow', on: true }, 0), null)
})
