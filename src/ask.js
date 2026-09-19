// Jev への聞き方と、答えの読み方。DOM に依存しない。
// Jev に送る文字列は英語にする。字幕だけは日本語のまま渡す（Jev は日本語の字幕をそのまま読める）。
// 前回の答えや、直前に出した演出は送らない。送ると自分の答えに引きずられる。連発の抑制は director がコードで行う。

import { ACTIVE_MOOD_IDS, CUES, CUE_BY_ID, CUE_IDS, FIREABLE_CUE_IDS, HEAT_LEVELS, MOODS, MOOD_BY_ID, MOOD_IDS, STYLES, STYLE_IDS } from './effects.js'

const TASK =
  'A person is talking to a camera in Japanese, and this is a live transcript of their speech. ' +
  'You are the editor of a Japanese TV variety show, adding on-screen sound-effect words, manga effects, sound effects and mood filters in real time. ' +
  'Judge from what the speaker means and how they say it, not from the literal characters in the text. ' +
  '"focus" is the utterance to judge: the newest words the speaker said. "focus_status" tells whether it is finished, paused, or still being spoken. ' +
  '"context" is what they said before, given only as background. "delivery" holds facts about how the focus was spoken, compared with this speaker\'s usual pace.'

/**
 * 判定の対象（focus）は 1 つに決める。話している途中ならその字幕、そうでなければ直前に確定した行。
 * 確定した行と話している途中の字幕を並べて渡すと、前の行のオチを新しい発話のものと取り違えて、同じオチで二度発火する。
 */
export function buildState({ earlier = '', latest = '', speakingNow = '' }, delivery = {}, { paused = false } = {}) {
  const speaking = Boolean(speakingNow)
  const context = speaking ? [earlier, latest].filter(Boolean).join(' ') : earlier
  return {
    task: TASK,
    transcript: {
      context: context || '(nothing)',
      focus: (speaking ? speakingNow : latest) || '(nothing yet)',
      // 字幕が止まったのを見て聞くときは、そのことも伝える。言い切ったかどうかの手がかりになる
      focus_status: !speaking ? 'just finished' : paused ? 'the speaker paused here, probably finished' : 'still being spoken, may be cut off',
    },
    delivery: { pace: delivery.pace ?? 'unknown', pause_before: delivery.pause_before ?? 'unknown' },
  }
}

const criteriaOf = (rows) => Object.fromEntries(rows.map((row) => [row.id, row.criteria]))

/** 閉集合の中から 1 つ選ばせる問い。choice は総和が 1 なので、必ずどれかに寄る。 */
export function choiceQuestions() {
  return {
    cue: {
      type: 'choice',
      instructions:
        'Which single effect fits the moment at the very end of "focus"? Pick "none" unless the newest words clearly call for one.',
      criteria: criteriaOf(CUES),
    },
    mood: {
      type: 'choice',
      instructions:
        'Which sustained mood has the talk settled into over the whole transcript, not just one line? Pick "none" unless the mood has clearly held for more than one sentence.',
      criteria: criteriaOf(MOODS),
    },
    telop_style: {
      type: 'choice',
      instructions: 'If "focus" were shown as a big on-screen caption, which caption style fits its tone?',
      criteria: criteriaOf(STYLES),
    },
  }
}

/**
 * 同じ項目を 1 つずつ Yes/No でも聞く。choice は相対評価で「どれも合わない」を表せないが、noul は絶対評価なので、
 * 何も出すべきでない場面では全部が低く出る。none には聞かない。
 */
export function noulQuestions() {
  const questions = {}
  for (const id of FIREABLE_CUE_IDS) {
    questions[`cue_${id}`] = { type: 'noul', instructions: `Would a variety-show editor add this effect at this exact moment? ${CUE_BY_ID[id].criteria}` }
  }
  for (const id of ACTIVE_MOOD_IDS) {
    questions[`mood_${id}`] = { type: 'noul', instructions: `Has the talk been in this mood for more than one sentence? ${MOOD_BY_ID[id].criteria}` }
  }
  return questions
}

/** 演出の種類とは別に聞く問い。オチ、言い切り、材料の乏しさ、熱量。 */
export function momentQuestions() {
  return {
    punchline: {
      type: 'noul',
      instructions: 'Did the speaker just deliver a punchline (オチ), the line that lands the joke or the payoff of the story, right at the end of "focus"?',
      criteria: {
        true: 'The newest words complete a joke, a twist, an absurd conclusion, a self-deprecating payoff or a sharp tsukkomi that an audience would laugh at.',
        false: 'Still setting up the story, plain explanation, filler, or the sentence is cut off before the payoff.',
      },
    },
    complete: {
      type: 'noul',
      instructions: 'Does "focus" end at a natural sentence ending, rather than being cut off mid-sentence?',
    },
    too_thin: {
      type: 'noul',
      instructions: 'Is "focus" too short, too empty or too cut off to judge what kind of moment this is?',
    },
    heat: {
      type: 'score',
      instructions:
        "How much energy and emotional intensity is in the speaker's newest words? Judge from wording, exclamations, repetition, elongated sounds and emphasis, not from the topic alone.",
      criteria: HEAT_LEVELS,
    },
  }
}

/** 実際に送る問い。全部を 1 リクエストに入れる。Jev は全質問を並列に評価するので、応答時間はほぼ変わらない。 */
export function buildQuestions() {
  return { ...choiceQuestions(), ...noulQuestions(), ...momentQuestions() }
}

export function normalize(dist, ids) {
  const total = ids.reduce((sum, id) => sum + Math.max(0, Number(dist?.[id]) || 0), 0)
  if (total <= 0) return null
  return Object.fromEntries(ids.map((id) => [id, Math.max(0, Number(dist?.[id]) || 0) / total]))
}

export function top(dist, n = 5) {
  return Object.entries(dist ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

const clamp01 = (v) => Math.min(1, Math.max(0, v))

// noul がこの値に届けば、choice の値をそのまま通す。届かなければ比例して下げる。
const NOUL_FULL = 0.6

/**
 * choice と noul を掛け合わせる。脳内メーカーは構成比が欲しかったので足し合わせたが、ここで欲しいのは「出すか出さないか」なので、
 * 絶対評価の noul が低いものは choice で勝っていても下げる。noul が返らなかった項目はそのまま通す。
 */
export function fuse(choice, nouls, ids) {
  return Object.fromEntries(ids.map((id) => [id, (choice?.[id] ?? 0) * (typeof nouls[id] === 'number' ? clamp01(nouls[id] / NOUL_FULL) : 1)]))
}

/**
 * score の答えを 0..1 の熱量にする。分布が返ればその期待値を、無ければ点の推定値を使う。
 * probabilities は配列で返ることも、段階の番号をキーにして返ることもある。
 */
export function heatOf(answer) {
  const last = HEAT_LEVELS.length - 1
  const raw = HEAT_LEVELS.map((_, k) => Math.max(0, Number(answer?.probabilities?.[k] ?? answer?.probabilities?.[String(k)]) || 0))
  const total = raw.reduce((a, b) => a + b, 0)
  if (total > 0) {
    const levels = raw.map((p) => p / total)
    return { heat: clamp01(levels.reduce((sum, p, k) => sum + p * k, 0) / last), levels, score: answer.score ?? null, confidence: answer.confidence ?? null }
  }
  if (typeof answer?.score === 'number') return { heat: clamp01(answer.score / last), levels: null, score: answer.score, confidence: answer.confidence ?? null }
  return { heat: null, levels: null, score: null, confidence: null }
}

const noulOf = (answers, key) => (typeof answers?.[key]?.noul === 'number' ? answers[key].noul : null)

function readGroup(answers, key, ids, fireable) {
  const choice = normalize(answers?.[key]?.probabilities, ids)
  const nouls = Object.fromEntries(fireable.map((id) => [id, noulOf(answers, `${key}_${id}`)]))
  const strength = fuse(choice, nouls, ids)
  const [best] = top(strength, 1)
  return { choice, nouls, strength, top: choice && best ? best[0] : 'none' }
}

/**
 * 答えを director が使う形に直す。欠けた答えがあっても例外にしない（欠けたぶんは「出さない」側に倒れる）。
 *   cue / mood: { choice, nouls, strength, top }
 *   style: 様式の id。punchline / complete / thin: 0..1。heat: 0..1（返らなければ中間の 0.5）
 */
export function readAnswers(answers) {
  const styles = normalize(answers?.telop_style?.probabilities, STYLE_IDS)
  const heat = heatOf(answers?.heat)
  return {
    cue: readGroup(answers, 'cue', CUE_IDS, FIREABLE_CUE_IDS),
    mood: readGroup(answers, 'mood', MOOD_IDS, ACTIVE_MOOD_IDS),
    style: styles ? top(styles, 1)[0][0] : 'plain',
    styles,
    punchline: noulOf(answers, 'punchline') ?? 0,
    complete: noulOf(answers, 'complete') ?? 0,
    thin: noulOf(answers, 'too_thin') ?? 0,
    heat: heat.heat ?? 0.5,
    heatDetail: heat,
  }
}
