// 瞬発系の画面効果。id は src/effects.js の FX に合わせる。どれも短い寿命で、自分で消える。
// world.still（動きを減らす設定）のときは、点滅と明滅をやめる。

import { focusLines, gloomLines } from '../geometry.js'
import { seeded } from '../rng.js'
import { clamp01, easeOutCubic, envelope, lerp } from '../timeline.js'

const center = (w) => (w.face ? { x: w.face.cx, y: w.face.cy + w.face.eyeDist * 0.4 } : { x: w.W / 2, y: w.H / 2 })

/** 集中線。顔が見えていれば顔へ、見えていなければ画面の中央へ向ける。50ms ごとに線を差し替えて、ちらつかせる。 */
function focus({ heat, dress, at }) {
  const ttlMs = 700 + 500 * heat
  const seed = Math.floor(at)
  return {
    id: 'focus',
    z: 60,
    update: (now) => now - at < ttlMs,
    draw(ctx, w) {
      const c = center(w)
      const flicker = w.still ? 0 : Math.floor((w.now - at) / 50) % 3
      const lines = focusLines({ cx: c.x, cy: c.y, W: w.W, H: w.H, count: dress.density, inner: lerp(0.62, 0.38, heat), seed: seed + flicker })
      ctx.save()
      ctx.globalAlpha = 0.88 * envelope(w.now - at, { inMs: 50, ttlMs, outMs: 200 })
      ctx.fillStyle = '#0a0a0a'
      // 線は 1 つのパスにまとめて 1 回で塗る。1 本ずつ塗ると本数ぶん遅くなる
      ctx.beginPath()
      for (const [a, b, tip] of lines) {
        ctx.moveTo(a[0], a[1])
        ctx.lineTo(b[0], b[1])
        ctx.lineTo(tip[0], tip[1])
        ctx.closePath()
      }
      ctx.fill()
      ctx.restore()
    },
    release() {},
  }
}

/** フラッシュ。まぶしい点滅は体調を崩す人がいるので、動きを減らす設定では出さない。 */
function flash({ heat, at }) {
  const ttlMs = 240
  return {
    id: 'flash',
    z: 65,
    update: (now) => now - at < ttlMs,
    draw(ctx, w) {
      if (w.still) return
      ctx.save()
      ctx.globalAlpha = lerp(0.35, 0.7, heat) * (1 - easeOutCubic((w.now - at) / ttlMs))
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w.W, w.H)
      ctx.restore()
    },
    release() {},
  }
}

/** 青ざめ縦線。画面の上から垂れる線と、上半分を沈める青い帯。 */
function gloomlines({ heat, at }) {
  const ttlMs = 1500
  const lines = gloomLines({ W: 1280, H: 720, count: Math.round(lerp(14, 30, heat)), seed: Math.floor(at) })
  return {
    id: 'gloomlines',
    z: 58,
    update: (now) => now - at < ttlMs,
    draw(ctx, w) {
      const level = envelope(w.now - at, { inMs: 160, ttlMs, outMs: 400 })
      ctx.save()
      ctx.globalCompositeOperation = 'multiply'
      const band = ctx.createLinearGradient(0, 0, 0, w.H * 0.6)
      band.addColorStop(0, `rgba(40, 50, 120, ${0.75 * level})`)
      band.addColorStop(1, 'rgba(40, 50, 120, 0)')
      ctx.fillStyle = band
      ctx.fillRect(0, 0, w.W, w.H * 0.6)
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = `rgba(20, 24, 70, ${0.8 * level})`
      const grow = w.still ? 1 : easeOutCubic((w.now - at) / 300)
      for (const line of lines) {
        ctx.lineWidth = line.width
        ctx.beginPath()
        ctx.moveTo(line.x, 0)
        ctx.lineTo(line.x, line.length * grow)
        ctx.stroke()
      }
      ctx.restore()
    },
    release() {},
  }
}

/** キラキラ。4 本の稜を持つ星を、顔のまわりに散らして瞬かせる。 */
function sparkle({ heat, at }) {
  const ttlMs = 1300
  const rand = seeded(Math.floor(at))
  const stars = Array.from({ length: Math.round(lerp(8, 18, heat)) }, () => ({
    angle: rand() * Math.PI * 2,
    dist: 0.9 + rand() * 1.8,
    size: 14 + rand() * 30,
    delay: rand() * 500,
    twinkle: 3 + rand() * 4,
  }))
  return {
    id: 'sparkle',
    z: 62,
    update: (now) => now - at < ttlMs,
    draw(ctx, w) {
      const c = center(w)
      const reach = w.face ? w.face.eyeDist * 1.6 : 170
      ctx.save()
      ctx.fillStyle = '#fffbe0'
      ctx.shadowColor = '#ffd23f'
      ctx.shadowBlur = 18
      for (const s of stars) {
        const t = w.now - at - s.delay
        const level = envelope(t, { inMs: 120, ttlMs: ttlMs - s.delay, outMs: 300 })
        if (level <= 0) continue
        const pulse = w.still ? 1 : 0.65 + 0.35 * Math.sin((t / 1000) * s.twinkle * Math.PI * 2)
        const r = s.size * level * pulse
        const x = c.x + Math.cos(s.angle) * s.dist * reach
        const y = c.y + Math.sin(s.angle) * s.dist * reach * 0.8
        ctx.globalAlpha = level
        ctx.beginPath()
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2
          const d = k % 2 ? r * 0.22 : r
          ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * d, y + Math.sin(a) * d)
        }
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
    },
    release() {},
  }
}

/** スポットライト。まわりを落として、顔だけを丸く残す（チーン）。 */
function spotlight({ at }) {
  const ttlMs = 2000
  return {
    id: 'spotlight',
    z: 55,
    update: (now) => now - at < ttlMs,
    draw(ctx, w) {
      const c = center(w)
      const radius = w.face ? w.face.eyeDist * 2.6 : 240
      const level = envelope(w.now - at, { inMs: 250, ttlMs, outMs: 500 })
      const hole = ctx.createRadialGradient(c.x, c.y, radius * 0.7, c.x, c.y, radius * 1.5)
      hole.addColorStop(0, 'rgba(0, 0, 0, 0)')
      hole.addColorStop(1, `rgba(0, 0, 8, ${0.82 * level})`)
      ctx.save()
      ctx.fillStyle = hole
      ctx.fillRect(0, 0, w.W, w.H)
      ctx.restore()
    },
    release() {},
  }
}

/** 画面ごと傾く（ズコー）。描くものは無く、ステージが angle() を読んで映像を回す。 */
function tilt({ heat, at }) {
  const ttlMs = 900
  return {
    id: 'tilt',
    z: 0,
    update: (now) => now - at < ttlMs,
    draw() {},
    angle(now, still) {
      if (still) return 0
      const t = (now - at) / ttlMs
      const swing = t < 0.25 ? easeOutCubic(t / 0.25) : 1 - easeOutCubic(clamp01((t - 0.55) / 0.45))
      return lerp(0.08, 0.16, heat) * swing
    },
    release() {},
  }
}

export const BURSTS = { focus, flash, gloomlines, sparkle, spotlight, tilt }
