// 字幕から演出イベントまでの配線。字幕を受け取り、scheduler に聞く時を決めさせ、Jev に聞き、答えを director に渡す。DOM に依存しない。
// 画面（main.js）も、実 API での通し検証（sim/live.js）も、これを通す。判断の経路を 2 つ持つと、検証したものと動かすものがずれる。

import { buildQuestions, buildState, readAnswers } from './ask.js'
import { createDirector } from './director.js'
import { createScheduler } from './scheduler.js'
import { createTranscript } from './transcript.js'

/**
 * ask({ state, questions }) は Jev に聞いて { answers, usage, latencyMs, hedged } を返す関数。キーの付け方は呼び出し側で決める。
 * 通知:
 *   onEvents(events)   演出イベントが出た
 *   onAnswer(detail)   答えを 1 つ採用した: { res, reading, verdict, events, ctx, state }
 *   onError(err)       聞くのに失敗した
 *   onCaptions()       字幕が変わった
 */
export function createPipeline({ ask, now = () => performance.now(), onEvents = () => {}, onAnswer = () => {}, onError = () => {}, onCaptions = () => {}, options = {} }) {
  const questions = buildQuestions()
  const scheduler = createScheduler(options.scheduler)
  const director = createDirector(options.director)
  let transcript = createTranscript()
  let epoch = 0 // reset で進める。古い応答を捨てるため
  let seq = 0
  let timer = null
  let blocked = false // キーや残高の問題。直すまで呼んでも無駄なので、聞くのをやめる
  let lastSpeechAt = -Infinity

  /** scheduler が「いま」と言えば聞き、そうでなければ次に確かめる時刻に起こしてもらう。 */
  function pump() {
    clearTimeout(timer)
    if (blocked) return
    const due = scheduler.due(now())
    if (due) send(due.source)
    const at = scheduler.wakeAt(now())
    if (at != null) timer = setTimeout(pump, Math.max(0, at - now()) + 1)
  }

  async function send(source) {
    const askedAt = now()
    const win = transcript.window(askedAt)
    // 確定を聞くときは、もう次の発話が始まっていても、確定した行のほうを判定の対象にする
    const line = transcript.lines.at(-1)
    const interim = source === 'final' ? '' : transcript.interim
    const focus = source === 'final' ? { ...win, speakingNow: '', uttId: line?.id ?? 0, focusChars: line?.text.length ?? 0 } : win
    if (!focus.latest && !focus.speakingNow) return
    const state = buildState(focus, transcript.delivery(askedAt), { paused: source === 'pause' })
    const mine = epoch
    const ctx = { seq: seq++, uttId: focus.uttId, chars: focus.focusChars, source, text: source === 'final' ? (line?.text ?? '') : interim, interim, askedAt }
    scheduler.note({ type: 'sent', source }, askedAt)
    let status = 200
    try {
      const res = await ask({ state, questions })
      if (mine !== epoch) return
      const at = now()
      const reading = readAnswers(res.answers)
      // 聞いてから答えが届くまでに字幕が伸びていたら、答えは途中までの字幕に対するもの
      const unchanged = source === 'final' || transcript.interim === interim
      const { events, verdict } = director.onAnswer(reading, { ...ctx, unchanged, speaking: Boolean(transcript.interim) }, at)
      if (events.length) onEvents(events)
      onAnswer({ res, reading, verdict, events, ctx, state })
    } catch (err) {
      status = err.status || 0
      blocked = Boolean(err.fatal)
      if (mine === epoch) onError(err)
    } finally {
      scheduler.note({ type: 'done', status }, now())
      pump()
    }
  }

  return {
    questions,
    director,
    scheduler,

    get transcript() {
      return transcript
    },

    interim(text) {
      const at = now()
      transcript.setInterim(text, at)
      if (transcript.interim) lastSpeechAt = at
      scheduler.note({ type: 'interim', text }, at)
      onCaptions()
      pump()
    },

    final(text) {
      const at = now()
      if (!transcript.addFinal(text, at)) return
      lastSpeechAt = at
      scheduler.note({ type: 'final' }, at)
      onCaptions()
      pump()
    },

    /** 定期的に呼ぶ。黙っているあいだのムードの減衰と、待たせていた声の切替。speaking はマイクの音量など、字幕より早い手がかり。 */
    tick(speaking = false) {
      const events = director.tick({ speaking: speaking || Boolean(transcript.interim), lastSpeechAt }, now())
      if (events.length) onEvents(events)
    },

    /** 手動発火。 */
    force(cueId, heat, telop = null) {
      const events = director.force(cueId, now(), heat, telop)
      if (events.length) onEvents(events)
    },

    reset() {
      epoch++
      clearTimeout(timer)
      transcript = createTranscript()
      scheduler.note({ type: 'reset' }, now())
      blocked = false
      const events = director.reset(now())
      if (events.length) onEvents(events)
      onCaptions()
    },

    stop() {
      epoch++
      clearTimeout(timer)
    },
  }
}
