// SE を鳴らす。assets/se/ に差し替え用のサンプルがあればそれを、無ければ合成レシピを使う。何を鳴らすかは呼び出し側が決める。

import { SE_IDS } from '../effects.js'
import { recipeFor } from './se-recipes.js'
import { playRecipe } from './se-synth.js'

/** 同時に鳴らせる数。超えたら新しいほうを捨てる。鳴っている音を途中で切ると、切れ目のほうが耳につく。 */
const MAX_PLAYING = 6

/** ファイル名から SE の id を取る。`laugh-2.mp3` → `laugh`。 */
export const sampleId = (file) => file.replace(/\.[^.]+$/, '').replace(/-\d+$/, '')

export function createSe(engine) {
  const samples = new Map()
  const loaded = new Set()
  /** 鳴っている SE の終わる時刻（performance.now() の ms）。 */
  let playing = []
  let lastEnd = 0

  async function loadOne(ctx, file) {
    const id = sampleId(file)
    if (!SE_IDS.includes(id) || loaded.has(file)) return
    loaded.add(file)
    try {
      const res = await fetch(`/assets/se/${encodeURIComponent(file)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer())
      samples.set(id, [...(samples.get(id) ?? []), buffer])
    } catch {
      // 読めないファイルは飛ばす。その id は合成で鳴るので、演出は止まらない
      loaded.delete(file)
    }
  }

  function playSample(ctx, buffer, t0, gain) {
    const src = ctx.createBufferSource()
    const level = ctx.createGain()
    src.buffer = buffer
    level.gain.value = gain
    src.connect(level).connect(engine.seBus)
    src.onended = () => {
      src.disconnect()
      level.disconnect()
    }
    src.start(t0)
    return { stopAt: t0 + buffer.duration }
  }

  return {
    /** files はサーバの /api/status が返す assets.se。読めた数を返す。 */
    async load(files = []) {
      const ctx = engine.ctx
      if (!ctx) return 0
      await Promise.all(files.map((file) => loadOne(ctx, file)))
      return loaded.size
    },

    /** 差し替え用のサンプルがあるか。無い id は合成で鳴る。 */
    has: (id) => samples.has(id),

    /** 鳴らしたら true。heat は合成の鳴り方を変えるだけで、音量は gain で受ける（熱量からどう決めるかは呼び出し側の仕事）。 */
    play(id, options) {
      const { heat = 0.5, gain = 1 } = options ?? {}
      const ctx = engine.ctx
      // 止まっている ctx に予約すると、再開した瞬間にまとめて鳴る
      if (ctx?.state !== 'running' || !SE_IDS.includes(id)) return false
      const now = performance.now()
      playing = playing.filter((end) => end > now)
      if (playing.length >= MAX_PLAYING) return false

      const t0 = ctx.currentTime
      const level = Number.isFinite(gain) ? Math.max(0, gain) : 1
      const pool = samples.get(id)
      const recipe = pool ? null : recipeFor(id, heat)
      if (!pool && !recipe) return false
      const { stopAt } = pool ? playSample(ctx, pool[Math.floor(Math.random() * pool.length)], t0, level) : playRecipe(ctx, engine.seBus, recipe, t0, level)

      const end = now + (stopAt - t0) * 1000
      playing.push(end)
      lastEnd = Math.max(lastEnd, end)
      return true
    },

    /** 最後の SE が鳴り終わる時刻（performance.now() の ms）。鳴っていなければ過去の時刻。 */
    busyUntil: () => lastEnd,
  }
}
