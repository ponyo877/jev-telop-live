// 画面に描く図形の座標を決める関数。ここで決めた数を、描く側はそのままパスにする。DOM に依存しない。

import { seeded } from './rng.js'

/** 映像を、縦横比を保ったままステージいっぱいに敷く（はみ出したぶんは切る）。 */
export function coverRect(vw, vh, W, H) {
  const s = Math.max(W / vw, H / vh)
  return { x: (W - vw * s) / 2, y: (H - vh * s) / 2, w: vw * s, h: vh * s }
}

/**
 * 集中線。画面の外周から中心へ向かう楔形の三角形の列を返す: [[外1, 外2, 先端], ...]。
 * 先端は中心のまわりの楕円の外で止める。inner は楕円の大きさ（画面の半分に対する比）。
 */
export function focusLines({ cx, cy, W, H, count, inner, seed }) {
  const rand = seeded(seed)
  const reach = Math.hypot(W, H)
  const lines = []
  for (let i = 0; i < count; i++) {
    const angle = ((i + rand() * 0.8) / count) * Math.PI * 2
    const half = (0.004 + rand() * 0.012) * Math.PI
    const tip = inner * (1 + rand() * 0.35)
    const point = (a, r) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
    lines.push([point(angle - half, reach), point(angle + half, reach), [cx + Math.cos(angle) * tip * (W / 2), cy + Math.sin(angle) * tip * (H / 2) * 0.62 * (W / H)]])
  }
  return lines
}

/** 青ざめ縦線。上から垂れる線の列: [{ x, length, width }]。 */
export function gloomLines({ W, H, count, seed }) {
  const rand = seeded(seed)
  return Array.from({ length: count }, (_, i) => ({
    x: ((i + 0.2 + rand() * 0.6) / count) * W,
    length: H * (0.18 + rand() * 0.3),
    width: 2 + rand() * 5,
  }))
}

/** 波打ち。高さ y の短冊を横へずらす量。 */
export const waveDx = (y, tMs, amp, wavelength = 140, hz = 0.8) => amp * Math.sin((2 * Math.PI * y) / wavelength + 2 * Math.PI * hz * (tMs / 1000))

/**
 * グリッチの帯。tick（80〜200ms ごとに進む番号）が同じあいだは同じ帯を返す: [{ y, h, dx }]。
 * 帯は画面の中に収め、ずれは強さに比例させる。
 */
export function glitchBands(seed, tick, intensity, H) {
  const rand = seeded(seed + tick * 7919)
  const count = 3 + Math.floor(rand() * (2 + 4 * intensity))
  return Array.from({ length: count }, () => {
    const h = 6 + rand() * (20 + 60 * intensity)
    const y = rand() * (H - h)
    return { y, h, dx: (rand() - 0.5) * 2 * (20 + 100 * intensity) }
  })
}

/** 雨粒。x, y, 長さ, 速さ, 層（0 = 奥, 1 = 手前）を 1 本の配列に詰める。 */
export const RAIN_FIELDS = 5
export function createRain(count, W, H, seed) {
  const rand = seeded(seed)
  const drops = new Float32Array(count * RAIN_FIELDS)
  for (let i = 0; i < count; i++) {
    const near = i % 3 === 0 ? 1 : 0
    drops.set([rand() * (W + 200), rand() * H, (near ? 28 : 16) * (0.7 + rand() * 0.6), (near ? 1500 : 1000) * (0.8 + rand() * 0.4), near], i * RAIN_FIELDS)
  }
  return drops
}

/** 雨粒を進める。下へ抜けたら上へ戻す。風で少し左へ流す。 */
export function stepRain(drops, dtMs, W, H, slant = -0.21) {
  const dt = dtMs / 1000
  for (let i = 0; i < drops.length; i += RAIN_FIELDS) {
    const fall = drops[i + 3] * dt
    drops[i] += fall * slant
    drops[i + 1] += fall
    if (drops[i + 1] > H + 40) {
      drops[i + 1] -= H + 80
      drops[i] = (drops[i] + W + 200) % (W + 200)
    }
    if (drops[i] < -40) drops[i] += W + 200
  }
}

/**
 * 擬音を置く場所の候補。顔に重ならないものを優先して、種で 1 つ選ぶ。
 * 画面の下 3 割は発話テロップが使うので、擬音は置かない。
 */
export const GIONGO_SLOTS = [
  { x: 0.2, y: 0.24 },
  { x: 0.8, y: 0.24 },
  { x: 0.18, y: 0.47 },
  { x: 0.82, y: 0.47 },
]

/** 顔が占める範囲。目尻の間隔を単位に、額から顎まで。 */
const faceBox = (face) => ({ left: face.cx - face.eyeDist * 1.5, right: face.cx + face.eyeDist * 1.5, top: face.cy - face.eyeDist * 1.5, bottom: face.cy + face.eyeDist * 2.1 })

/**
 * 擬音の中心を決める。size は擬音の絵の大きさ { w, h }。
 * 候補の中心点が顔から離れていても、大きな擬音は顔にかぶる。画面に収めたあとの矩形と、顔の矩形が重ならない候補から選ぶ。
 * どれも重なるなら、顔からいちばん遠い候補にする。
 */
export function pickSlot(face, W, H, seed, size = { w: 0, h: 0 }) {
  const rand = seeded(seed)
  const margin = 16
  const placed = GIONGO_SLOTS.map((slot) => ({
    x: Math.min(W - size.w / 2 - margin, Math.max(size.w / 2 + margin, slot.x * W)),
    y: Math.min(H - size.h / 2 - margin, Math.max(size.h / 2 + margin, slot.y * H)),
  }))
  const tilt = (rand() - 0.5) * 0.28
  if (!face) return { ...placed[Math.floor(rand() * placed.length)], tilt }
  const box = faceBox(face)
  const clear = (p) => p.x + size.w / 2 < box.left || p.x - size.w / 2 > box.right || p.y + size.h / 2 < box.top || p.y - size.h / 2 > box.bottom
  const free = placed.filter(clear)
  if (free.length) return { ...free[Math.floor(rand() * free.length)], tilt }
  const far = placed.reduce((best, p) => (Math.hypot(p.x - face.cx, p.y - face.cy) > Math.hypot(best.x - face.cx, best.y - face.cy) ? p : best))
  return { ...far, tilt }
}
