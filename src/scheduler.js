// Jev にいつ聞くかを決める。DOM に依存しない。時刻はすべて引数でもらい、タイマーは呼び出し側（main.js と sim）が持つ。
// 演出は喋りから 0.5〜1 秒で出したいので、確定を待たずに認識途中の字幕でも聞く。聞く経路は 3 つ。
//   final   字幕が確定した。すぐ聞く
//   pause   認識途中の字幕が止まった。言い切って黙ったとみて、確定を待たずに 1 回だけ聞く（同じ字幕を interim で聞いたあとでも）
//   interim 認識途中の字幕が前に聞いたときから十分変わった

export const DEFAULTS = {
  minGapMs: 500, // 呼び出しの最短間隔。応答の中央値が 270ms 前後なので、これより詰めても答えが追い越し合うだけ
  interimGapMs: 600, // 認識途中の字幕で聞く間隔
  interimGrowth: 4, // 前に聞いたときからこの文字数だけ変わったら聞く
  pauseMs: 350, // 字幕がこれだけ止まったら、言い切ったとみなす
  finalGapMs: 250, // 確定が立て続けに来たときの間隔
  maxInflight: 2, // 同時に飛ばす数。1 本は確定のために空けておく
  perMinute: 150, // 安全弁。何かが壊れて呼び続けても、費用がここで止まる
  backoffMaxMs: 4000,
  backoffCalmMs: 10000, // 429 がこれだけ出なければ、間隔を元に戻す
}

export function createScheduler(options = {}) {
  const o = { ...DEFAULTS, ...options }
  let interim = ''
  let interimChangedAt = -Infinity
  let asked = '' // 最後に聞いたときの認識途中の字幕
  let pauseAsked = false
  let pendingFinal = false
  let inflight = 0
  let lastSentAt = -Infinity
  let lastFinalSentAt = -Infinity
  let gap = o.minGapMs
  let last429At = -Infinity
  let sent = []

  // 長さの差だけでなく、音声認識が前のほうを書き直したときも「変わった」とみなす
  const changed = () => Math.abs(interim.length - asked.length) >= o.interimGrowth || !interim.startsWith(asked)

  const calm = (now) => {
    if (gap > o.minGapMs && now - last429At >= o.backoffCalmMs) gap = o.minGapMs
    sent = sent.filter((t) => now - t < 60000)
  }

  /** いま聞けるなら経路を、聞けないなら「次に確かめる時刻」を返す。 */
  function plan(now) {
    calm(now)
    if (sent.length >= o.perMinute) return { source: null, at: sent[0] + 60000 }
    const waits = []
    if (pendingFinal) {
      // 確定は最短間隔を待たない。ただし 429 で間隔を広げているあいだは従う
      const at = Math.max(lastFinalSentAt + o.finalGapMs, gap > o.minGapMs ? lastSentAt + gap : -Infinity)
      if (inflight < o.maxInflight) {
        if (now >= at) return { source: 'final', at: now }
        waits.push(at)
      }
    }
    if (interim && inflight < o.maxInflight - 1) {
      if (changed()) {
        const at = lastSentAt + Math.max(gap, o.interimGapMs)
        if (now >= at) return { source: 'interim', at: now }
        waits.push(at)
      }
      // 同じ字幕を「伸びた」で聞いたばかりでも、止まったら聞き直す。発話テロップは伸びている最中の字幕では出さないので、
      // ここで聞かないと、確定が届くまでテロップを出せない。
      if (!pauseAsked) {
        const at = Math.max(interimChangedAt + o.pauseMs, lastSentAt + gap)
        if (now >= at) return { source: 'pause', at: now }
        waits.push(at)
      }
    }
    return { source: null, at: waits.length ? Math.min(...waits) : null }
  }

  return {
    /**
     * 起きたことを知らせる。
     *   { type: 'interim', text } / { type: 'final' } 字幕が届いた
     *   { type: 'sent', source } due() の経路で実際に聞いた / { type: 'done', status } 応答が返った（失敗なら HTTP ステータス）
     *   { type: 'reset' }
     */
    note(event, now) {
      if (event.type === 'interim') {
        const text = event.text.trim()
        if (text === interim) return
        interim = text
        interimChangedAt = now
        pauseAsked = false
      } else if (event.type === 'final') {
        pendingFinal = true
        interim = ''
        asked = ''
        pauseAsked = false
      } else if (event.type === 'sent') {
        inflight++
        lastSentAt = now
        sent.push(now)
        if (event.source === 'final') {
          pendingFinal = false
          lastFinalSentAt = now
        } else {
          asked = interim
          if (event.source === 'pause') pauseAsked = true
        }
      } else if (event.type === 'done') {
        inflight = Math.max(0, inflight - 1)
        // レート制限（429）と過負荷（529）。公式の案内も、すぐ投げ直さずに間隔を広げること
        if (event.status === 429 || event.status === 529) {
          gap = Math.min(o.backoffMaxMs, gap * 2)
          last429At = now
        }
      } else if (event.type === 'reset') {
        interim = asked = ''
        pendingFinal = pauseAsked = false
      }
    },

    /** いま聞くべきなら { source } を返す。 */
    due(now) {
      const { source } = plan(now)
      return source ? { source } : null
    },

    /** 次に due() を確かめる時刻。応答待ちで決まらないときは null（done を知らせたあとに確かめ直す）。 */
    wakeAt(now) {
      return plan(now).at
    },

    get gapMs() {
      return gap
    },

    callsPerMinute(now) {
      calm(now)
      return sent.length
    },
  }
}
