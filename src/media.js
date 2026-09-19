// 演出イベントを、画面（stage）と音（audio）へ振り分ける。判断はしない。届いたものを、そのまま出すだけ。
// director が出したイベントも、手動のボタンが出したイベントも、同じ道を通る。

import { validate } from './bus.js'

export function createMedia({ stage, audio }) {
  const voices = new Set()
  return {
    /** 閉集合に無いものや古すぎるものは出さずに、理由を返す。出したら null。 */
    handle(event) {
      const refused = validate(event, performance.now())
      if (refused) return refused
      if (event.kind === 'oneshot') {
        stage.fire(event)
        if (event.layers?.se) audio.playSe(event.layers.se, { heat: event.heat, gain: event.dress.gain })
      } else if (event.layer === 'voice') {
        // 声は、モニタ出力を閉じていても加工はしておく。開けた瞬間から効いているように
        audio.setVoice(event.id, event.on, event.intensity ?? 0.5)
        if (event.on) voices.add(event.id)
        else voices.delete(event.id)
      } else {
        stage.setAmbient(event)
      }
      return null
    },

    /** いま有効な持続効果。パネルの表示に使う。 */
    active() {
      return { ...stage.active(), voice: [...voices] }
    },

    clear() {
      stage.clear()
      for (const id of voices) audio.setVoice(id, false, 0)
      voices.clear()
    },
  }
}
