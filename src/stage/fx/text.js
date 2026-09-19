// 文字の演出。擬音（閉集合の決まった文字）と、発話テロップ（音声認識の字幕そのもの）。

import { pickSlot } from '../geometry.js'
import { hash, seeded } from '../rng.js'
import { createSpriteCache, drawSprite, measurer, renderSprite } from '../telop-draw.js'
import { layoutTelop } from '../telop-layout.js'
import { GIONGO_LOOK, STYLE_LOOK } from '../telop-styles.js'
import { motionPose } from '../timeline.js'

const GIONGO_PX = 118
const GIONGO_MAX_PX = 210
const TELOP_PX = 82
const TELOP_MAX_PX = 140
const cached = createSpriteCache()

const spriteOf = (kind, id, text, look, px) => cached(`${kind}|${id}|${text}|${Math.round(px / 4) * 4}`, () => renderSprite([text], look, Math.round(px / 4) * 4))

/** 「ざわ…ざわ…」を「ざわ…」ずつに分ける。漂う擬音は、かたまりごとに別々に動かす。 */
const pieces = (text) => text.match(/[^…]+…*/g) ?? [text]

/** 擬音。顔に重ならない場所へ、cue ごとの動きで出す。 */
export function createGiongo({ cue, text, dress, at, world }) {
  const look = GIONGO_LOOK[cue]
  const px = Math.min(GIONGO_MAX_PX, GIONGO_PX * dress.scale)
  const seed = hash(text) + Math.floor(at)
  const drifting = look.motion === 'drift'
  const ttlMs = drifting ? Math.max(dress.ttlMs, 2600) : dress.ttlMs
  const rand = seeded(seed)
  let slot = null
  const parts = (drifting ? pieces(text) : [text]).map((part, i, all) => {
    const sprite = spriteOf('giongo', cue, part, look, drifting ? px * 0.7 : px)
    // 置き場所は、絵の大きさが分かってから決める。大きな擬音ほど顔にかぶりやすい
    slot = pickSlot(world.face, world.W, world.H, seed + i, { w: sprite.w, h: sprite.h })
    // 漂う擬音は画面の左右に散らし、出るタイミングもずらす
    const x = drifting ? world.W * (i % 2 ? 0.78 : 0.2) + (rand() - 0.5) * 160 : slot.x
    const y = drifting ? world.H * (0.25 + 0.5 * rand()) : slot.y
    return {
      sprite,
      x: Math.min(world.W - sprite.w / 2 - 16, Math.max(sprite.w / 2 + 16, x)),
      y: Math.min(world.H - sprite.h / 2 - 16, Math.max(sprite.h / 2 + 16, y)),
      delay: drifting ? (i / all.length) * ttlMs * 0.45 : 0,
      life: drifting ? ttlMs * 0.55 : ttlMs,
      phase: rand() * Math.PI * 2,
    }
  })
  return {
    id: `giongo:${cue}`,
    z: 70,
    update: (now) => now - at < ttlMs,
    draw(ctx, w) {
      for (const p of parts) {
        const pose = motionPose(look.motion, w.now - at - p.delay, p.life, { still: w.still, phase: p.phase })
        drawSprite(ctx, p.sprite, p.x, p.y, pose, { tilt: drifting ? 0 : slot.tilt })
      }
    },
    release() {},
  }
}

/** 発話テロップ。画面の下に、様式ごとの見た目で出す。長さが読めないので、収まるように割って縮める。 */
export function createTelop({ text, style, dress, at, world }) {
  const look = STYLE_LOOK[style] ?? STYLE_LOOK.plain
  const basePx = Math.min(TELOP_MAX_PX, TELOP_PX * dress.scale)
  // 画面の下 3 割あまりに収める。それより上は擬音と顔の場所
  const laid = layoutTelop(text, { maxWidth: world.W * 0.86, maxHeight: world.H * 0.34, maxLines: 3, basePx, minPx: 40, measure: measurer(look) })
  if (!laid.lines.length) return null
  const sprite = renderSprite(laid.lines, look, laid.px)
  const x = world.W / 2
  const y = world.H - 40 - sprite.h / 2
  return {
    id: 'telop',
    z: 80,
    update: (now) => now - at < dress.ttlMs,
    draw(ctx, w) {
      drawSprite(ctx, sprite, x, y, motionPose(look.motion, w.now - at, dress.ttlMs, { still: w.still }), { tilt: ((look.tilt ?? 0) * Math.PI) / 180, skew: look.skew ?? 0 })
    },
    release() {},
  }
}
