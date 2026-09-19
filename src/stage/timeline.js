// 時間から姿勢を決める関数。演出の動きはすべてここで決まり、描く側は返った値を当てはめるだけ。DOM に依存しない。
// still（動きを減らす設定）のときは、途中の動きを飛ばして落ち着いた姿勢を返す。テロップは情報なので消さない。

export const clamp01 = (v) => Math.min(1, Math.max(0, v))
export const lerp = (a, b, t) => a + (b - a) * t

export const easeOutCubic = (t) => 1 - (1 - clamp01(t)) ** 3
export const easeInCubic = (t) => clamp01(t) ** 3

/** 行きすぎてから戻る。叩きつける動きに使う。 */
export function easeOutBack(t, overshoot = 1.70158) {
  const u = clamp01(t) - 1
  return 1 + (overshoot + 1) * u ** 3 + overshoot * u ** 2
}

export function easeOutBounce(t) {
  let u = clamp01(t)
  const n = 7.5625
  const d = 2.75
  if (u < 1 / d) return n * u * u
  if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75
  if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375
  return n * (u -= 2.625 / d) * u + 0.984375
}

/** 入り・保持・抜けの包絡。0 → 1 → 0。 */
export function envelope(tMs, { inMs, ttlMs, outMs }) {
  if (tMs < 0 || tMs >= ttlMs) return 0
  if (tMs < inMs) return tMs / inMs
  if (tMs > ttlMs - outMs) return (ttlMs - tMs) / outMs
  return 1
}

/** 持続系の入り抜け。level を target へ、時定数 tau で寄せる。 */
export const approach = (level, target, dtMs, tauMs) => level + (target - level) * (1 - Math.exp(-dtMs / tauMs))

/** 画面の揺れ。乱数を使わず、減衰する 2 つの正弦にする。同じ時刻なら同じ揺れ。 */
export function shake(tMs, amp, ttlMs = 450) {
  if (tMs < 0 || tMs >= ttlMs || amp <= 0) return { x: 0, y: 0 }
  const t = tMs / 1000
  const decay = Math.exp(-6 * t) * (1 - tMs / ttlMs)
  return { x: amp * decay * Math.sin(2 * Math.PI * 31 * t), y: amp * decay * Math.cos(2 * Math.PI * 27 * t) }
}

const REST = { x: 0, y: 0, scale: 1, rot: 0, alpha: 1 }
const IN_MS = 120
const OUT_MS = 180

/**
 * 擬音とテロップの動き。戻り値は置き場所からのずれ: { x, y, scale, rot, alpha }（x, y は px、rot はラジアン）。
 *   slam   大きく現れて叩きつけ、保持のあいだ小刻みに震える（ドン!、ビシッ!）
 *   drop   上から落ちてきて 1 回弾む（ガーン、ズコー）
 *   pop    弾むように現れる（キラーン、ええっ!?）
 *   drift  斜め上へ漂いながら揺れる（ざわ…）
 *   fade   ゆっくり現れて沈む（シーン…、チーン）
 *   rumble 現れたあと揺れ続ける（ゴゴゴゴ、メラメラ）
 *   shiver 小刻みに震え続ける（ホラー調のテロップ）
 */
export function motionPose(motion, tMs, ttlMs, { still = false, phase = 0 } = {}) {
  if (tMs < 0 || tMs >= ttlMs) return { ...REST, alpha: 0 }
  const out = clamp01((ttlMs - tMs) / OUT_MS)
  if (still) return { ...REST, alpha: Math.min(clamp01(tMs / IN_MS), out) }
  const t = tMs / 1000
  switch (motion) {
    case 'slam': {
      const hit = clamp01(tMs / 80)
      const tremble = tMs > 80 ? 2 * Math.sin(2 * Math.PI * 30 * t + phase) * out : 0
      return { x: tremble, y: tremble * 0.6, scale: lerp(2.4, 1, easeOutBack(hit)) * lerp(1.25, 1, out), rot: 0, alpha: Math.min(clamp01(tMs / 40), out) }
    }
    case 'drop':
      return { x: 0, y: lerp(-260, 0, easeOutBounce(tMs / 520)), scale: 1, rot: lerp(-0.12, 0, easeOutCubic(tMs / 520)), alpha: Math.min(clamp01(tMs / 80), out) }
    case 'pop':
      return { x: 0, y: 0, scale: lerp(0.2, 1, easeOutBack(tMs / 260, 2.6)), rot: 0.06 * Math.sin(2 * Math.PI * 1.5 * t + phase), alpha: Math.min(clamp01(tMs / 80), out) }
    case 'drift': {
      const p = tMs / ttlMs
      return { x: 40 * p + 8 * Math.sin(2 * Math.PI * 0.9 * t + phase), y: -60 * p, scale: lerp(0.9, 1.1, p), rot: 0.05 * Math.sin(2 * Math.PI * 0.7 * t + phase), alpha: Math.sin(Math.PI * clamp01(p)) }
    }
    case 'fade':
      return { x: 0, y: 24 * easeInCubic(tMs / ttlMs), scale: 1, rot: 0, alpha: Math.min(clamp01(tMs / 500), clamp01((ttlMs - tMs) / 500)) }
    case 'rumble':
      return { x: 5 * Math.sin(2 * Math.PI * 17 * t + phase), y: 4 * Math.cos(2 * Math.PI * 13 * t + phase), scale: lerp(0.7, 1, easeOutCubic(tMs / 300)), rot: 0, alpha: Math.min(clamp01(tMs / 150), out) }
    case 'shiver':
      return { x: 3 * Math.sin(2 * Math.PI * 23 * t + phase), y: 2 * Math.cos(2 * Math.PI * 19 * t), scale: 1, rot: 0, alpha: Math.min(clamp01(tMs / 300), out) }
    default:
      return { ...REST, alpha: Math.min(clamp01(tMs / IN_MS), out) }
  }
}
