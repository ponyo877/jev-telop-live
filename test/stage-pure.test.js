import test from 'node:test'
import assert from 'node:assert'
import { CUES, FIREABLE_CUE_IDS, STYLE_IDS } from '../src/effects.js'
import { coverRect, createRain, focusLines, glitchBands, pickSlot, stepRain, waveDx, RAIN_FIELDS } from '../src/stage/geometry.js'
import { hash, seeded } from '../src/stage/rng.js'
import { LINE_HEIGHT, layoutTelop } from '../src/stage/telop-layout.js'
import { FONTS, GIONGO_LOOK, STYLE_LOOK, fontOf } from '../src/stage/telop-styles.js'
import { approach, easeOutBack, envelope, motionPose, shake } from '../src/stage/timeline.js'

// 全角 1em、半角 0.5em の偽の測り方
const measure = (text, px) => [...text].reduce((w, ch) => w + (ch.charCodeAt(0) < 0x2000 ? 0.5 : 1), 0) * px

test('閉集合のすべての擬音と様式に、見た目がある', () => {
  assert.deepStrictEqual(Object.keys(GIONGO_LOOK).sort(), [...FIREABLE_CUE_IDS].sort())
  assert.deepStrictEqual(Object.keys(STYLE_LOOK).sort(), [...STYLE_IDS].sort())
  for (const look of [...Object.values(GIONGO_LOOK), ...Object.values(STYLE_LOOK)]) {
    assert.ok(FONTS[look.font], look.font)
    assert.strictEqual(look.fill.length, 2)
    assert.ok(look.strokes.length >= 1)
    for (let i = 1; i < look.strokes.length; i++) assert.ok(look.strokes[i].width < look.strokes[i - 1].width, '縁取りは外側から順に細くなる')
    assert.notStrictEqual(motionPose(look.motion, 300, 1500).alpha, undefined)
  }
  assert.match(fontOf(STYLE_LOOK.impact, 63.6), /^400 64px "Dela Gothic One"/, 'Google Fonts は 400 で指定する')
  assert.ok(CUES.length > 1)
})

test('イージングと包絡は端で 0 と 1。叩きつける動きは行きすぎてから戻る', () => {
  assert.ok(Math.abs(easeOutBack(0)) < 1e-9)
  assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-9)
  assert.ok(easeOutBack(0.6) > 1)
  const env = { inMs: 100, ttlMs: 1000, outMs: 200 }
  assert.deepStrictEqual([-1, 0, 50, 500, 900, 1000].map((t) => envelope(t, env)), [0, 0, 0.5, 1, 0.5, 0])
  assert.ok(approach(0, 1, 300, 300) > 0.6 && approach(0, 1, 300, 300) < 0.65)
})

test('動きは寿命の外では見えず、動きを減らす設定では位置も大きさも変えない', () => {
  for (const motion of ['slam', 'drop', 'pop', 'drift', 'fade', 'rumble', 'shiver', 'default']) {
    assert.strictEqual(motionPose(motion, -1, 1000).alpha, 0, motion)
    assert.strictEqual(motionPose(motion, 1000, 1000).alpha, 0, motion)
    const mid = motionPose(motion, 500, 1000)
    assert.ok(mid.alpha > 0.9 && Number.isFinite(mid.x + mid.y + mid.scale + mid.rot), motion)
    assert.deepStrictEqual(motionPose(motion, 500, 1000, { still: true }), { x: 0, y: 0, scale: 1, rot: 0, alpha: 1 }, motion)
  }
  assert.ok(motionPose('slam', 0, 1000).scale > 2, '大きく現れる')
  assert.ok(motionPose('drop', 0, 1000).y < -200, '上から落ちる')
})

test('画面の揺れは減衰して、終わりには止まる', () => {
  assert.ok(Math.hypot(shake(20, 12).x, shake(20, 12).y) > 3)
  assert.ok(Math.hypot(shake(400, 12).x, shake(400, 12).y) < 0.3)
  assert.deepStrictEqual(shake(450, 12), { x: 0, y: 0 })
  assert.deepStrictEqual(shake(100, 0), { x: 0, y: 0 })
})

test('映像は縦横比を保ってステージいっぱいに敷く', () => {
  assert.deepStrictEqual(coverRect(1280, 720, 1280, 720), { x: 0, y: 0, w: 1280, h: 720 })
  assert.deepStrictEqual(coverRect(640, 480, 1280, 720), { x: 0, y: -120, w: 1280, h: 960 }, '4:3 は上下が切れる')
})

test('集中線は同じ種なら同じ形で、先端は中心に届かない', () => {
  const args = { cx: 640, cy: 360, W: 1280, H: 720, count: 60, inner: 0.5, seed: 7 }
  const lines = focusLines(args)
  assert.strictEqual(lines.length, 60)
  assert.deepStrictEqual(lines, focusLines(args))
  assert.notDeepStrictEqual(lines, focusLines({ ...args, seed: 8 }))
  for (const [, , tip] of lines) {
    const r = Math.hypot((tip[0] - 640) / 640, (tip[1] - 360) / (360 * 0.62 * (1280 / 720)))
    assert.ok(r >= 0.5 - 1e-9, `先端が内側の楕円に入っている: ${r}`)
  }
})

test('波のずれは振幅を超えず、グリッチの帯は画面に収まる', () => {
  for (let y = 0; y < 720; y += 6) assert.ok(Math.abs(waveDx(y, 1234, 24)) <= 24)
  const bands = glitchBands(1, 5, 1, 720)
  assert.deepStrictEqual(bands, glitchBands(1, 5, 1, 720), '同じ tick なら同じ帯')
  assert.notDeepStrictEqual(bands, glitchBands(1, 6, 1, 720))
  for (const band of bands) assert.ok(band.y >= 0 && band.y + band.h <= 720 && Math.abs(band.dx) <= 120)
})

test('雨粒は下へ落ち、抜けたら上へ戻る', () => {
  const drops = createRain(30, 1280, 720, 3)
  assert.strictEqual(drops.length, 30 * RAIN_FIELDS)
  const before = drops[1]
  stepRain(drops, 16, 1280, 720)
  assert.ok(drops[1] > before)
  for (let i = 0; i < 400; i++) stepRain(drops, 16, 1280, 720)
  for (let i = 0; i < drops.length; i += RAIN_FIELDS) assert.ok(drops[i + 1] <= 760 && drops[i] >= -40 && drops[i] <= 1480 + 1e-3)
})

test('擬音は、絵の大きさを含めて顔に重ならない場所に置く', () => {
  // 画面の上中央に小さく映った顔と、幅 700px の大きな擬音。中心点だけで選ぶと、上の候補は顔にかぶる
  const face = { cx: 640, cy: 95, eyeDist: 45 }
  const size = { w: 700, h: 260 }
  for (let seed = 0; seed < 30; seed++) {
    const p = pickSlot(face, 1280, 720, seed, size)
    const overlaps = p.x - size.w / 2 < face.cx + 67 && p.x + size.w / 2 > face.cx - 67 && p.y - size.h / 2 < face.cy + 95 && p.y + size.h / 2 > face.cy - 67
    assert.ok(!overlaps, `seed ${seed}: (${p.x}, ${p.y})`)
    assert.ok(p.x - size.w / 2 >= 16 && p.x + size.w / 2 <= 1264, '画面に収まる')
  }
  // 顔が画面いっぱいで、どこに置いても重なるなら、顔からいちばん遠い候補にする
  const huge = { cx: 640, cy: 360, eyeDist: 400 }
  const p = pickSlot(huge, 1280, 720, 1, size)
  assert.ok(Math.hypot(p.x - 640, p.y - 360) > 250)
  assert.ok(pickSlot(null, 1280, 720, 1).x > 0)
  assert.strictEqual(hash('ドン!'), hash('ドン!'))
  assert.notStrictEqual(seeded(1)(), seeded(2)())
})

test('短い発話は 1 行で、元の大きさのまま', () => {
  assert.deepStrictEqual(layoutTelop('なんでやねん', { maxWidth: 1000, basePx: 80, measure }), { px: 80, lines: ['なんでやねん'], truncated: false })
  assert.deepStrictEqual(layoutTelop('  ', { maxWidth: 1000, basePx: 80, measure }).lines, [])
})

test('入らなければ、ほぼ同じ長さの 2 行に割る。行頭に句読点や小書きの字を置かない', () => {
  const out = layoutTelop('箱を開けたら、中身が空っぽだったんです', { maxWidth: 900, basePx: 80, measure })
  assert.strictEqual(out.lines.length, 2)
  assert.strictEqual(out.lines.join(''), '箱を開けたら、中身が空っぽだったんです')
  assert.ok(Math.abs(out.lines[0].length - out.lines[1].length) <= 5, out.lines.join(' / '))
  for (const line of out.lines) {
    assert.doesNotMatch(line, /^[、。っゃゅょー！？]/, line)
    assert.ok(measure(line, out.px) <= 900)
  }
})

test('それでも入らなければ縮め、最後は末尾を切る。絵文字は途中で割らない', () => {
  const long = 'これは本当に長い発話で、音声認識が区切ってくれないまま延々と続いてしまった場合の字幕です'
  const shrunk = layoutTelop(long, { maxWidth: 900, basePx: 80, minPx: 44, measure })
  assert.ok(shrunk.px < 80 && shrunk.px >= 44 && !shrunk.truncated)
  assert.strictEqual(shrunk.lines.join(''), long)
  const cut = layoutTelop(long.repeat(3), { maxWidth: 600, basePx: 80, minPx: 44, maxLines: 2, measure })
  assert.ok(cut.truncated)
  assert.strictEqual(cut.lines.length, 2)
  assert.ok(cut.lines[1].endsWith('…'))
  for (const line of cut.lines) assert.ok(measure(line, cut.px) <= 600)
  const emoji = layoutTelop('👨‍👩‍👧'.repeat(12), { maxWidth: 200, basePx: 40, minPx: 40, maxLines: 2, measure })
  for (const line of emoji.lines) assert.doesNotMatch(line.replace(/…$/, ''), /^‍|‍$/)
})

test('熱量が高くて文字が大きくても、テロップの高さは上限に収まる。行が増えるほど文字は小さくなる', () => {
  const text = '箱を開けたら、中身が空っぽだったんです'
  const out = layoutTelop(text, { maxWidth: 1100, maxHeight: 245, basePx: 139, minPx: 40, measure })
  assert.ok(out.lines.length * out.px * LINE_HEIGHT <= 245, `${out.lines.length} 行 × ${out.px}px`)
  assert.strictEqual(out.lines.join(''), text)
  assert.ok(out.px >= 70, `読める大きさは保つ: ${out.px}px`)
  const short = layoutTelop('なんでやねん', { maxWidth: 1100, maxHeight: 245, basePx: 139, minPx: 40, measure })
  assert.deepStrictEqual([short.lines.length, short.px], [1, 139], '短い発話は 1 行で大きく')
})

test('助詞や助動詞の前でも、動詞の途中でも割らない。文節の切れ目で折る', () => {
  const fold = (text) => layoutTelop(text, { maxWidth: 1100, maxHeight: 245, basePx: 100, minPx: 40, measure }).lines.join(' / ')
  assert.strictEqual(fold('箱を開けたら、中身が空っぽだったんです'), '箱を開けたら、中身が / 空っぽだったんです', '「中身 / が」にしない')
  assert.strictEqual(fold('問い合わせたら仕様ですって言われて、もう何も言えなかった'), '問い合わせたら / 仕様ですって言われて、 / もう何も言えなかった', '「言 / われて」にしない')
  assert.strictEqual(fold('そのあと一人で部屋で泣きました。雨も降ってきてさ'), 'そのあと一人で部屋で / 泣きました。雨も降ってきてさ', '「泣き / ました」にしない')
  assert.strictEqual(fold('でもね、俺は天才だから、自分で作ることにしたんですよ'), 'でもね、俺は天才だから、 / 自分で作ることにしたんですよ')
  assert.strictEqual(fold('いやなんでやねん、箱だけ売るなよ'), 'いやなんでやねん、 / 箱だけ売るなよ')
})
