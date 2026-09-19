// 持続系の画面効果。id は src/effects.js の SCREEN に合わせる。on で入り、off で抜け、抜けきったら消える。
// 強さ（intensity、0..1）は director が決める。ここでは、それを自分の量（雨粒の数、暗さ、波の振幅）に写す。

import { RAIN_FIELDS, createRain, glitchBands, stepRain, waveDx } from '../geometry.js'
import { approach, lerp } from '../timeline.js'

// 効果は入ってから消えきるまでを 3 秒に収めたいので、入りも抜けも速くする。抜けは 3τ ≒ 0.5 秒でほぼ消える
const TAU_IN = 250
const TAU_OUT = 160
// director が落ちても効果が出っぱなしにならないよう、送り直しが途絶えたら自分で抜ける
const ORPHAN_MS = 90000

/** 入り抜けの包絡を持つ土台。level は 0..1 で、target へ時定数で寄る。 */
function ambient(id, z, extra) {
  const self = {
    id,
    z,
    level: 0,
    on: true,
    intensity: 0.5,
    touchedAt: null,
    set(on, intensity, now) {
      self.on = on
      if (on) self.intensity = intensity
      self.touchedAt = now
    },
    update(now, dt, w) {
      self.touchedAt ??= now
      if (self.on && now - self.touchedAt > ORPHAN_MS) self.on = false
      self.level = approach(self.level, self.on ? 1 : 0, dt, self.on ? TAU_IN : TAU_OUT)
      extra.step?.(self, dt, w)
      return self.on || self.level > 0.002
    },
    draw: (ctx, w) => extra.draw?.(self, ctx, w),
    release(now) {
      self.set(false, 0, now)
    },
  }
  if (extra.transfer) self.transfer = (ctx, scene, w) => extra.transfer(self, ctx, scene, w)
  return self
}

let vignette = null
/** まわりを落とす絵は毎回同じなので、1 回だけ焼く。 */
function vignetteOf(W, H) {
  if (vignette?.width === W) return vignette
  vignette = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H })
  const ctx = vignette.getContext('2d')
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, W * 0.62)
  g.addColorStop(0, 'rgba(0, 0, 0, 0)')
  g.addColorStop(1, 'rgba(0, 0, 0, 1)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  return vignette
}

const dark = () =>
  ambient('dark', 40, {
    draw(self, ctx, w) {
      ctx.save()
      ctx.globalAlpha = self.level * lerp(0.35, 0.75, self.intensity)
      ctx.fillStyle = '#02030a'
      ctx.fillRect(0, 0, w.W, w.H)
      ctx.globalAlpha = self.level
      ctx.drawImage(vignetteOf(w.W, w.H), 0, 0)
      ctx.restore()
    },
  })

const redtint = () =>
  ambient('redtint', 41, {
    draw(self, ctx, w) {
      ctx.save()
      ctx.globalCompositeOperation = 'multiply'
      ctx.globalAlpha = self.level * lerp(0.4, 0.8, self.intensity)
      ctx.fillStyle = '#ff3b30'
      ctx.fillRect(0, 0, w.W, w.H)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = self.level * 0.6
      ctx.drawImage(vignetteOf(w.W, w.H), 0, 0)
      ctx.restore()
    },
  })

const scanline = () =>
  ambient('scanline', 42, {
    draw(self, ctx, w) {
      ctx.save()
      ctx.globalCompositeOperation = 'multiply'
      ctx.globalAlpha = self.level * 0.5
      ctx.fillStyle = '#7dffb2'
      ctx.fillRect(0, 0, w.W, w.H)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = self.level * lerp(0.25, 0.5, self.intensity)
      ctx.fillStyle = '#001a0a'
      // 走査線。ゆっくり流して、止まった縞に見えないようにする
      const offset = w.still ? 0 : (w.now / 40) % 4
      for (let y = -4 + offset; y < w.H; y += 4) ctx.fillRect(0, y, w.W, 2)
      ctx.restore()
    },
  })

const RAIN_MAX = 600
const rain = () => {
  const drops = createRain(RAIN_MAX, 1280, 720, 20260919)
  return ambient('rain', 50, {
    step(self, dt, w) {
      if (!w.still) stepRain(drops, dt, w.W, w.H)
    },
    draw(self, ctx, w) {
      ctx.save()
      ctx.globalAlpha = self.level * 0.25
      ctx.fillStyle = '#34465e'
      ctx.fillRect(0, 0, w.W, w.H)
      // 動きを減らす設定では、色だけ沈めて粒は描かない
      if (!w.still) {
        const count = Math.round(lerp(150, RAIN_MAX, self.intensity) * self.level)
        ctx.lineCap = 'round'
        // 層ごとに 1 つのパスにまとめる。1 粒ずつ stroke すると 600 回の描画になる
        for (const near of [0, 1]) {
          ctx.globalAlpha = self.level * (near ? 0.7 : 0.4)
          ctx.strokeStyle = near ? '#dfeaff' : '#a9bbd6'
          ctx.lineWidth = near ? 2.2 : 1.2
          ctx.beginPath()
          for (let i = 0; i < count; i++) {
            const k = i * RAIN_FIELDS
            if (drops[k + 4] !== near) continue
            ctx.moveTo(drops[k], drops[k + 1])
            ctx.lineTo(drops[k] - drops[k + 2] * 0.21, drops[k + 1] + drops[k + 2])
          }
          ctx.stroke()
        }
      }
      ctx.restore()
    },
  })
}

// ---------- 映像そのものを歪めるもの ----------
// scene（映像と顔の効果を描いたキャンバス）から画面へ写すところを引き受ける。画素は読み戻さず、短冊ごとの drawImage だけで歪める。

const STRIP = 6

const wave = () =>
  ambient('wave', 30, {
    transfer(self, ctx, scene, w) {
      const amp = self.level * lerp(4, 24, self.intensity)
      if (w.still || amp < 0.5) return ctx.drawImage(scene, 0, 0, w.W, w.H)
      for (let y = 0; y < w.H; y += STRIP) {
        const dx = waveDx(y, w.now, amp)
        // ずらしたぶん端に隙間ができるので、少し広げて貼る
        ctx.drawImage(scene, 0, y, w.W, STRIP, dx - amp, y, w.W + amp * 2, STRIP)
      }
    },
  })

const blank = (W, H) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H }))
let channel = null // 1 色だけ残した絵
let split = null // 色をずらして組み直した絵

const glitch = () => {
  let tick = 0
  let nextAt = 0
  return ambient('glitch', 31, {
    transfer(self, ctx, scene, w) {
      ctx.drawImage(scene, 0, 0, w.W, w.H)
      if (w.still || self.level < 0.05) return
      if (w.now >= nextAt) {
        tick++
        nextAt = w.now + 80 + 120 * Math.random()
      }
      const strength = self.level * self.intensity
      // 色ずれ。赤だけの絵と水色だけの絵を、黒地の上で左右にずらして足し合わせると、色のずれた元の絵に戻る。
      // 元の絵の上へ直に足すと、画面全体が明るく飛んでしまう。
      channel ??= blank(w.W, w.H)
      split ??= blank(w.W, w.H)
      const c = channel.getContext('2d')
      const s = split.getContext('2d')
      const shift = lerp(3, 14, strength)
      s.globalCompositeOperation = 'source-over'
      s.fillStyle = '#000000'
      s.fillRect(0, 0, w.W, w.H)
      s.globalCompositeOperation = 'lighter'
      for (const [color, dx] of [['#ff0000', -shift], ['#00ffff', shift]]) {
        c.globalCompositeOperation = 'source-over'
        c.drawImage(scene, 0, 0, w.W, w.H)
        c.globalCompositeOperation = 'multiply'
        c.fillStyle = color
        c.fillRect(0, 0, w.W, w.H)
        s.drawImage(channel, dx, 0)
      }
      ctx.save()
      ctx.globalAlpha = self.level
      ctx.drawImage(split, 0, 0)
      ctx.restore()
      for (const band of glitchBands(20260919, tick, strength, w.H)) {
        ctx.drawImage(scene, 0, band.y, w.W, band.h, band.dx, band.y, w.W, band.h)
      }
    },
  })
}

export const AMBIENTS = { dark, rain, wave, glitch, redtint, scanline }
