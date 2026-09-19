// 擬音とテロップを絵にする。縁取りを何重にも重ねるのは重いので、出す瞬間に 1 回だけ別のキャンバスへ焼き、毎フレームはそれを貼るだけにする。

import { LINE_HEIGHT } from './telop-layout.js'
import { fontOf } from './telop-styles.js'

function blank(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

const scratch = blank(8, 8).getContext('2d')

/** 文字幅を測る。layoutTelop に渡す。 */
export function measurer(look) {
  return (text, px) => {
    scratch.font = fontOf(look, px)
    return scratch.measureText(text).width
  }
}

/** lines を look の見た目で焼く。戻り値は { canvas, w, h }。 */
export function renderSprite(lines, look, px) {
  const font = fontOf(look, px)
  scratch.font = font
  const widths = lines.map((line) => scratch.measureText(line).width)
  const pad = Math.ceil(px * (look.strokes[0].width / 2 + 0.12))
  const lineH = px * LINE_HEIGHT
  const w = Math.ceil(Math.max(...widths, 1) + pad * 2)
  const h = Math.ceil(lineH * lines.length + pad * 2)
  const canvas = blank(w, h)
  const ctx = canvas.getContext('2d')
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // 角を丸めないと、太い縁取りの尖った角が文字の外へ突き出る
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2

  const each = (draw) => lines.forEach((line, i) => draw(line, w / 2, pad + lineH * (i + 0.5)))

  // 影。いちばん外の縁取りを、右下へずらして敷く
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
  ctx.lineWidth = px * look.strokes[0].width
  each((line, x, y) => ctx.strokeText(line, x + px * 0.05, y + px * 0.06))

  // 縁取りは外側から順に重ねる
  for (const stroke of look.strokes) {
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = px * stroke.width
    each((line, x, y) => ctx.strokeText(line, x, y))
  }

  each((line, x, y) => {
    const fill = ctx.createLinearGradient(0, y - px * 0.5, 0, y + px * 0.5)
    fill.addColorStop(0.15, look.fill[0])
    fill.addColorStop(0.85, look.fill[1])
    ctx.fillStyle = fill
    ctx.fillText(line, x, y)
  })
  return { canvas, w, h }
}

/** 焼いた絵を、pose（motionPose の戻り値）のとおりに貼る。 */
export function drawSprite(ctx, sprite, x, y, pose, { tilt = 0, skew = 0 } = {}) {
  if (pose.alpha <= 0) return
  ctx.save()
  ctx.globalAlpha *= pose.alpha
  ctx.translate(x + pose.x, y + pose.y)
  ctx.rotate(tilt + pose.rot)
  if (skew) ctx.transform(1, 0, skew, 1, 0, 0)
  ctx.scale(pose.scale, pose.scale)
  ctx.drawImage(sprite.canvas, -sprite.w / 2, -sprite.h / 2)
  ctx.restore()
}

/** 同じ擬音は何度も出るので、焼いた絵を取っておく。 */
export function createSpriteCache(limit = 48) {
  const cache = new Map()
  return (key, make) => {
    if (cache.has(key)) return cache.get(key)
    if (cache.size >= limit) cache.delete(cache.keys().next().value)
    const sprite = make()
    cache.set(key, sprite)
    return sprite
  }
}

/**
 * Google Fonts は文字の範囲ごとに分割して配られるので、描く文字列を指定して読み込まないと、その字が入ったファイルが来ない。
 * 喋りに遅れたくないので長くは待たない。間に合わなければシステムのフォントで描かれる。
 */
export async function ensureFont(look, text, waitMs = 250) {
  if (typeof document === 'undefined' || !document.fonts) return
  const load = document.fonts.load(fontOf(look, 64), text).catch(() => {})
  await Promise.race([load, new Promise((resolve) => setTimeout(resolve, waitMs))])
}
