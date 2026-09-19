// 字幕の置き場と、Jev に渡す範囲（窓）の切り出し。DOM に依存しない。
// 確定した字幕（final）は 1 行ずつ積み、認識途中の字幕（interim）は 1 つだけ持って上書きする。
// 演出は 1 つの発話に 1 回だけ出したいので、発話に id を振る。話し方（速さ、間）も字幕の届いた時刻から数える。

const MAX_AGE_MS = 30000
const MAX_CHARS = 120
const KEEP_LINES = 40
const KEEP_RATES = 20
const MIN_RATES = 5 // 本人のふだんの速さが分かるまでに要る発話の数

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function createTranscript({ maxAgeMs = MAX_AGE_MS, maxChars = MAX_CHARS } = {}) {
  let nextId = 1
  let lines = []
  let interim = ''
  let interimStartedAt = null // いまの発話の最初の字幕が届いた時刻
  let interimChangedAt = null // 認識途中の字幕が最後に変わった時刻
  let lastFinalAt = null
  let rates = [] // これまでの発話の速さ（文字/秒）
  let lastDelivery = { pace: 'unknown', pause_before: 'unknown' }

  /** 生の ms ではなく、本人の中央値と比べた言葉にする。Jev は数字の大小より言葉のほうを素直に読む。 */
  const paceOf = (rate) => {
    if (rate == null || rates.length < MIN_RATES) return 'unknown'
    const usual = median(rates)
    return rate > usual * 1.25 ? 'fast' : rate < usual * 0.75 ? 'slow' : 'normal'
  }
  const pauseOf = (startedAt) => {
    if (startedAt == null || lastFinalAt == null) return 'unknown'
    const gap = startedAt - lastFinalAt
    return gap < 400 ? 'none' : gap < 1500 ? 'short' : 'long'
  }
  const rateOf = (chars, startedAt, now) => {
    const sec = (now - startedAt) / 1000
    return startedAt == null || sec < 0.3 ? null : chars / sec
  }

  return {
    addFinal(text, t) {
      const trimmed = text.trim()
      const startedAt = interimStartedAt
      interim = ''
      interimStartedAt = interimChangedAt = null
      if (!trimmed) return null
      const line = { id: nextId++, text: trimmed, t }
      lines.push(line)
      lines = lines.slice(-KEEP_LINES)
      // 文字で打ち込んだ発話は途中の字幕が無いので、速さは数えない
      const rate = rateOf(trimmed.length, startedAt, t)
      lastDelivery = { pace: paceOf(rate), pause_before: pauseOf(startedAt) }
      if (rate != null) rates = [...rates, rate].slice(-KEEP_RATES)
      lastFinalAt = t
      return line
    },

    /** t を渡すと、話し方と「字幕が止まってからの時間」を数えられる。 */
    setInterim(text, t) {
      const next = text.trim()
      if (next !== interim && t != null) {
        interimChangedAt = t
        if (!interim) interimStartedAt = t
      }
      if (!next) interimStartedAt = interimChangedAt = null
      interim = next
    },

    get lines() {
      return lines
    },

    get interim() {
      return interim
    },

    /** 認識途中の字幕が変わらなくなってからの ms。言い切って黙ったのを、確定を待たずに拾うのに使う。 */
    interimStableMs(now) {
      return interim && interimChangedAt != null ? now - interimChangedAt : 0
    },

    /**
     * Jev に渡す範囲。新しい行から順に、maxAgeMs 以内かつ合計 maxChars 以内のものを入れる。
     * 最新の 1 行は古くても長くても必ず入れる（長すぎれば末尾だけ）。黙っているあいだに判断材料が空にならないように。
     * 最新の 1 行（latest）とそれより前（earlier）は分けて返す。Jev には新しい発話を重く見させたいので。
     * 間を置かずに話し続けると確定が来ず、認識途中の字幕が伸び続ける。こちらも末尾の maxChars 文字だけを渡す。
     * uttId は、いま判定の対象になっている発話の id。認識途中の字幕には「次の確定が取る id」を付けるので、
     * 途中の字幕とその確定は同じ id になり、同じ発話で演出を二度出さずに済む。
     */
    window(now) {
      const used = []
      let chars = 0
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]
        const first = used.length === 0
        if (!first && (now - line.t > maxAgeMs || chars + line.text.length > maxChars)) break
        used.unshift(line)
        chars += line.text.length
      }
      const latest = (used.at(-1)?.text ?? '').slice(-maxChars)
      const earlier = used.slice(0, -1).map((l) => l.text).join(' ')
      return {
        earlier,
        latest,
        speakingNow: interim.slice(-maxChars),
        usedIds: used.map((l) => l.id),
        uttId: interim ? nextId : (lines.at(-1)?.id ?? 0),
        focusChars: interim ? interim.length : (lines.at(-1)?.text.length ?? 0),
      }
    },

    /** 話し方の事実。話している途中ならその発話の、そうでなければ直前の発話のもの。 */
    delivery(now) {
      if (!interim) return lastDelivery
      return { pace: paceOf(rateOf(interim.length, interimStartedAt, now)), pause_before: pauseOf(interimStartedAt) }
    },
  }
}
