// 演出イベントの通り道。director も手動発火のボタンも、ここへ同じ形のイベントを流す。DOM に依存しない。
//   瞬発: { kind: 'oneshot', at, cue, layers: { giongo, fx, se }, telop: { text, style } | null, heat, dress, ... }
//   持続: { kind: 'ambient', at, layer: 'shades' | 'face' | 'screen' | 'voice', id, on, intensity, mood }

import { CUE_BY_ID, LAYERS, STYLE_BY_ID } from './effects.js'

/** 届くのが遅すぎた瞬発イベントは出さない。喋りから離れた演出は、無いより悪い。 */
const MAX_AGE_MS = 1500

/** 閉集合に無い id や、古すぎる瞬発イベントを弾く。理由を返し、問題なければ null。 */
export function validate(event, now) {
  if (event?.kind === 'oneshot') {
    if (event.cue != null && !CUE_BY_ID[event.cue]) return `unknown cue: ${event.cue}`
    if (event.telop && !STYLE_BY_ID[event.telop.style]) return `unknown style: ${event.telop.style}`
    if (!event.cue && !event.telop) return 'empty oneshot'
    if (now - event.at > MAX_AGE_MS) return 'stale'
    return null
  }
  if (event?.kind === 'ambient') {
    if (!LAYERS[event.layer]?.includes(event.id)) return `unknown ambient: ${event.layer}/${event.id}`
    return null
  }
  return 'unknown kind'
}

export function createBus() {
  const listeners = new Set()
  return {
    on(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    emit(event) {
      for (const fn of listeners) fn(event)
    },
  }
}
