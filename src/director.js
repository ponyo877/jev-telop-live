// Jev の答えを、画面と音に出す演出イベントに変える。DOM に依存しない。時刻はすべて引数でもらう。
// Jev は「いま何が合うか」を答えるだけで、出しすぎや二度出しは気にしない。それを抑えるのはコードの役目。
//   瞬発系（擬音・画面効果・SE・発話テロップ）: しきい値を超えたら 1 発話に 1 回だけ出す
//   持続系（顔・画面・声）: 答えをならし、入りと抜けのしきい値を分けて、ちらつかせない

import { CUE_BY_ID, FIREABLE_CUE_IDS, MOOD_IDS, STYLE_BY_ID, expandCue, expandMood } from './effects.js'

export const DEFAULTS = {
  // 瞬発系。早い経路ほど字幕が不確かなので、しきい値を上げる。
  // 実測（sim/probe.js）では、ふつうの話の擬音の強さは 0.2 以下。Jev の票が 2〜3 の擬音に割れた行は 0.3〜0.45 に来るので、それを拾える高さにしてある
  cueThreshold: { final: 0.35, pause: 0.45, interim: 0.6 },
  // 実測では、ふつうの話と相づちは 0.05 以下、オチの行は 0.52〜0.88。文脈を渡していれば、字幕が止まった時点でも確定時とほぼ同じ値が出る
  punchlineThreshold: { final: 0.4, pause: 0.45 },
  // 言い終えてもまだ何も出していなければ、必ず何か出す。喋ったのに何も起きない発話を無くす。
  // none を除いた中でいちばんの擬音に少しでも根拠があればそれを、無ければその発話をテロップにする（ふつうの話は plain の小さめの字幕になる）。
  // 確定を待つと 3 秒遅れるので、字幕が止まって、言い切ったと Jev が答えた時点でも出す
  everyUtterance: true,
  fallbackCueMin: 0.12, // none を除いて選び直した擬音に要る強さ
  fallbackNoulMin: 0.25, // 同じく、その擬音の noul（絶対評価）に要る値
  fallbackMinChars: 4, // 「はい」「うん」のような短い相づちには出さない
  completeMin: 0.6, // 確定を待たずに発話テロップを出すときに要る「言い切った」の確からしさ
  thinBlock: 0.7, // 判断材料が乏しい確率がこれ以上なら、瞬発系は一切出さない
  staleMs: 1500, // 応答がこれより遅れたら瞬発系には使わない。喋りから離れた演出は、無いより悪い
  // 確定が来ないまま喋り続けたとき、同じ発話でもこれだけ伸びたらもう一度出してよい。
  // Apple の音声認識は、言い終わってから確定を返すまでに 3 秒ほどかかる（実測 2.9 秒）。続けて喋ると次の文も同じ発話に入るので、1 文ぶんの長さにしてある
  regrowChars: 12,
  maxTtlMs: 3000, // 擬音とテロップを出しておく時間の上限
  cueGapMs: 1500,
  sameCueMs: 8000,
  telopGapMs: 1500, // 発話テロップは、前のものが消えてから出す。これはそれとは別の、最短の間隔
  telopClearMs: 200, // 前のテロップが消えてから、次を出すまでの間
  rateWindowMs: 20000,
  // この時間に演出を出してよい発話の数。擬音とそのテロップは同じ発話なので、1 つと数える。
  // 10 文字前後の短い文で喋ると、20 秒に 9 つほど入る。それには毎回応えたいので、ふつうの会話では当たらない高さにしてある。
  // 画面が埋まらないようにする役目は、擬音の間隔と、テロップを前のものが消えてから出す決まりが担う。これは暴走を止める最後の歯止め
  rateMax: 12,
  // 持続系
  moodAlpha: 0.5, // 1 回の高い答えでは入らず、2 回続くと入る
  moodEnter: 0.55,
  moodExit: 0.3,
  // ムードの効果（レンズの色、顔、画面、声）は、入ってから消えきるまでを 3 秒に収める。ここで切ってから、画面側のフェードアウトに 0.5 秒ほどかかる。
  // Jev は字幕全体を見てムードを答えるので、悲しい話が終わっても、その字幕が残っているあいだは同じムードを答え続ける。長く保つと、次の話の上にも雨が降る
  moodMinHoldMs: 2400,
  moodMaxHoldMs: 2400,
  moodRefractoryMs: 15000, // 切ったムードは、しばらく入れない
  layerMaxHoldMs: {}, // レイヤーごとの最長。ムードより先に切り上げたいレイヤーがあれば指定する（例: { screen: 8000 }）
  moodSeenMin: 0.5, // ムードは、別々の発話 2 つ以上でこの強さが出たときだけ入る。1 つの発話の中で答えが続いても入らない
  moodSeenMs: 30000,
  silenceMs: 6000,
  silenceTauMs: 4000,
  voiceHoldMs: 3000, // 声の切替は発話の切れ目まで待つ。喋り続けていたら、ここで諦めて切り替える
  intensityStep: 0.15,
}

const clamp01 = (v) => Math.min(1, Math.max(0, v))

/** 判断材料が乏しい確率が 0.5 を超えるぶんだけ、答えの重みを下げる。相づちだけで演出が出ないように。 */
export const damp = (thin) => 1 - 0.8 * clamp01((thin - 0.5) / 0.5)

/** 熱量を見た目と音の量に写す。描画と音はこの値をそのまま使い、写し方を二重に持たない。 */
export function dress(heat, textLength = 0, maxTtlMs = DEFAULTS.maxTtlMs) {
  const h = clamp01(heat)
  return {
    scale: 0.8 + 1.0 * h,
    shake: h < 0.5 ? 0 : (h - 0.5) * 24,
    gain: 0.35 + 0.65 * h,
    density: Math.round(24 + 72 * h),
    ttlMs: Math.min(maxTtlMs, Math.round(900 + 900 * h + 60 * textLength)),
  }
}

/**
 * 発話テロップに出す文字列。最後の文を取り、長ければ最後の読点より後ろ、それでも長ければ末尾だけにする。
 * どこを見せるかは文字数で決まる事実なので、Jev には聞かない。
 */
export function telopText(text, max = 28) {
  // 「!?」のように終わりの記号が続くところでは割らない
  const sentences = (text ?? '').trim().split(/(?<=[。！？!?])(?![。！？!?])/).map((s) => s.trim()).filter(Boolean)
  let out = (sentences.at(-1) ?? '').replace(/[。\s]+$/, '')
  if (out.length > max) {
    const tail = out.slice(out.lastIndexOf('、') + 1)
    out = tail.length >= 6 && tail.length <= max ? tail : out.slice(-max)
  }
  return out
}

export function createDirector(options = {}) {
  const o = { ...DEFAULTS, ...options }
  let lastSeq = -Infinity
  let fired = { cue: null, telop: null } // { uttId, atChars }
  let lastCueAt = -Infinity
  let lastTelopAt = -Infinity
  let telopEndsAt = -Infinity
  const cueAt = {} // cue ごとの最後に出した時刻
  let recent = [] // 直近に演出を出した発話: { at, uttId }
  let moodSeen = {} // ムードごとの、強く出た発話: { [moodId]: Map(uttId → 時刻) }
  let ema = Object.fromEntries(MOOD_IDS.map((id) => [id, 0]))
  let mood = { active: 'none', since: -Infinity }
  const refractoryUntil = {}
  let applied = new Map() // `${layer}/${id}` → { layer, id, intensity }
  let heldVoice = null // 発話の切れ目を待っている声の切替: { since, events }
  let speaking = false
  let lastTickAt = null

  const sameUtterance = (slot, ctx) => slot && slot.uttId === ctx.uttId && ctx.chars - slot.atChars < o.regrowChars

  const overRate = (now, uttId) => {
    recent = recent.filter((r) => now - r.at < o.rateWindowMs)
    return recent.length >= o.rateMax && !recent.some((r) => r.uttId === uttId)
  }

  function judgeCue(reading, ctx, now, stale) {
    const id = reading.cue.top
    const strength = (reading.cue.strength[id] ?? 0) * damp(reading.thin)
    const verdict = (reason) => ({ id, strength, fired: reason === 'fired', reason })
    if (stale) return verdict('stale')
    if (reading.thin >= o.thinBlock) return verdict('thin')
    if (id === 'none' || !CUE_BY_ID[id]) return verdict('none')
    if (strength < o.cueThreshold[ctx.source]) return verdict('weak')
    if (sameUtterance(fired.cue, ctx)) return verdict('same-utterance')
    if (now - lastCueAt < o.cueGapMs) return verdict('gap')
    if (now - (cueAt[id] ?? -Infinity) < o.sameCueMs) return verdict('same-cue')
    if (overRate(now, ctx.uttId)) return verdict('rate')
    return verdict('fired')
  }

  function judgeTelop(reading, ctx, now, stale) {
    const text = telopText(ctx.text)
    const verdict = (reason) => ({ text, style: reading.style, punchline: reading.punchline, fired: reason === 'fired', reason })
    if (stale) return verdict('stale')
    if (reading.thin >= o.thinBlock) return verdict('thin')
    // 出す文字列そのものが途中だと困るので、伸びている最中の字幕では出さない
    if (ctx.source === 'interim') return verdict('source')
    if (reading.punchline < o.punchlineThreshold[ctx.source] || !text) return verdict('weak')
    if (ctx.source === 'pause' && (reading.complete < o.completeMin || !ctx.unchanged)) return verdict('incomplete')
    if (sameUtterance(fired.telop, ctx)) return verdict('same-utterance')
    if (now - lastTelopAt < o.telopGapMs || now < telopEndsAt + o.telopClearMs) return verdict('gap')
    if (overRate(now, ctx.uttId)) return verdict('rate')
    return verdict('fired')
  }

  /**
   * 何も出せなかった発話に、代わりに出すものを決める。戻り値は { cue } か { telop } か null。
   * 連発の抑制（間隔、同じ擬音、出しすぎ）は、ここでも守る。
   */
  function fallback(reading, ctx, now) {
    if (overRate(now, ctx.uttId)) return null
    const [id, strength] = FIREABLE_CUE_IDS.map((cue) => [cue, reading.cue.strength[cue] ?? 0]).sort((a, b) => b[1] - a[1])[0]
    const noul = reading.cue.nouls[id]
    const backed = strength >= o.fallbackCueMin && (typeof noul !== 'number' || noul >= o.fallbackNoulMin)
    if (backed && now - lastCueAt >= o.cueGapMs && now - (cueAt[id] ?? -Infinity) >= o.sameCueMs) return { cue: id, strength }
    const text = telopText(ctx.text)
    if ([...text].length < o.fallbackMinChars) return null
    if (now - lastTelopAt < o.telopGapMs || now < telopEndsAt + o.telopClearMs) return null
    return { telop: { text, style: reading.style } }
  }

  function oneshot({ cue, telop, heat, ctx, now, why }) {
    const layers = expandCue(cue, heat)
    // 発話テロップだけのときは様式の SE を鳴らす。ただし直前に cue の SE を鳴らしたばかりなら重ねない
    if (!cue && telop && now - lastCueAt >= o.cueGapMs) layers.se = STYLE_BY_ID[telop.style]?.se ?? null
    return { kind: 'oneshot', at: now, uttId: ctx?.uttId ?? null, source: ctx?.source ?? 'manual', cue, layers, telop, heat, dress: dress(heat, telop?.text.length ?? 0, o.maxTtlMs), why }
  }

  // ---------- 持続系 ----------

  const intensityOf = (id) => clamp01((ema[id] - o.moodExit) / 0.5)

  /** いまの ema から、あるべきムードを決める。 */
  function nextMood(now) {
    const held = now - mood.since
    const sustained = (id) => [...(moodSeen[id]?.values() ?? [])].filter((at) => now - at < o.moodSeenMs).length >= 2
    const open = (id) => id !== 'none' && ema[id] >= o.moodEnter && sustained(id) && now >= (refractoryUntil[id] ?? -Infinity)
    const best = MOOD_IDS.filter(open).sort((a, b) => ema[b] - ema[a])[0] ?? null
    if (mood.active === 'none') return best ?? 'none'
    if (held >= o.moodMaxHoldMs) {
      refractoryUntil[mood.active] = now + o.moodRefractoryMs
      return best && best !== mood.active ? best : 'none'
    }
    if (held < o.moodMinHoldMs) return mood.active
    if (best && best !== mood.active && ema[best] > ema[mood.active]) return best
    return ema[mood.active] < o.moodExit ? 'none' : mood.active
  }

  /** あるべきレイヤーの集合と、いま出ている集合の差だけをイベントにする。ムードが替わっても共通のレイヤーは触らない。 */
  function syncMood(now) {
    const next = nextMood(now)
    if (next !== mood.active) mood = { active: next, since: now }
    const intensity = mood.active === 'none' ? 0 : intensityOf(mood.active)
    const held = now - mood.since
    const wanted = new Map(
      expandMood(mood.active)
        .filter((e) => held < (o.layerMaxHoldMs[e.layer] ?? Infinity))
        .map((e) => [`${e.layer}/${e.id}`, e]),
    )
    const events = []
    for (const [key, e] of applied) {
      if (wanted.has(key)) continue
      applied.delete(key)
      events.push({ kind: 'ambient', at: now, layer: e.layer, id: e.id, on: false, intensity: 0, mood: mood.active })
    }
    for (const [key, e] of wanted) {
      const current = applied.get(key)
      if (current && Math.abs(current.intensity - intensity) < o.intensityStep) continue
      applied.set(key, { ...e, intensity })
      events.push({ kind: 'ambient', at: now, layer: e.layer, id: e.id, on: true, intensity, mood: mood.active })
    }
    return holdVoice(events, now)
  }

  /** 声の切替は、喋っている最中には出さない。声色が言葉の途中で変わると、演出ではなく故障に聞こえる。 */
  function holdVoice(events, now) {
    const voice = events.filter((e) => e.layer === 'voice')
    if (voice.length) {
      // 待っているあいだに打ち消された切替（on のあと off）は、あとのものだけ残す
      const merged = new Map((heldVoice?.events ?? []).map((e) => [e.id, e]))
      for (const e of voice) merged.set(e.id, e)
      heldVoice = { since: heldVoice?.since ?? now, events: [...merged.values()] }
    }
    const rest = events.filter((e) => e.layer !== 'voice')
    if (heldVoice && (!speaking || now - heldVoice.since >= o.voiceHoldMs)) {
      rest.push(...heldVoice.events.map((e) => ({ ...e, at: now })))
      heldVoice = null
    }
    return rest
  }

  return {
    /**
     * 答えが 1 つ届くたびに呼ぶ。
     *   reading: ask.readAnswers() の戻り値
     *   ctx: { seq, uttId, chars, source: 'final' | 'pause' | 'interim', text, askedAt, unchanged, speaking? }
     *        unchanged は、聞いた時点の focus が、答えが届いたいまも同じかどうか
     */
    onAnswer(reading, ctx, now) {
      if (ctx.speaking != null) speaking = ctx.speaking
      // 2 本同時に飛ばすので、答えが追い越されることがある。追い越された古い答えは使わない
      const outdated = ctx.seq != null && ctx.seq < lastSeq
      if (ctx.seq != null && !outdated) lastSeq = ctx.seq
      const stale = outdated || now - ctx.askedAt > o.staleMs
      let cue = judgeCue(reading, ctx, now, stale)
      let telop = judgeTelop(reading, ctx, now, stale)
      const events = []

      // 言い終えたのに、この発話でまだ何も出していなければ、代わりのものを出す
      const silent = !sameUtterance(fired.cue, ctx) && !sameUtterance(fired.telop, ctx)
      const finished = ctx.source === 'final' || (ctx.source === 'pause' && ctx.unchanged && reading.complete >= o.completeMin)
      if (o.everyUtterance && finished && !stale && !cue.fired && !telop.fired && silent) {
        const pick = fallback(reading, ctx, now)
        if (pick?.cue) cue = { ...cue, id: pick.cue, strength: pick.strength, fired: true, reason: 'fallback' }
        else if (pick?.telop) telop = { ...telop, ...pick.telop, fired: true, reason: 'fallback' }
      }

      if (cue.fired || telop.fired) {
        const slot = { uttId: ctx.uttId, atChars: ctx.chars }
        const event = oneshot({
          cue: cue.fired ? cue.id : null,
          telop: telop.fired ? { text: telop.text, style: telop.style } : null,
          heat: reading.heat,
          ctx,
          now,
          why: { strength: cue.strength, punchline: reading.punchline, thin: reading.thin },
        })
        if (cue.fired) {
          fired.cue = slot
          lastCueAt = cueAt[cue.id] = now
        }
        if (telop.fired) {
          fired.telop = slot
          lastTelopAt = now
          telopEndsAt = now + event.dress.ttlMs
        }
        if (!recent.some((r) => r.uttId === ctx.uttId)) recent.push({ at: now, uttId: ctx.uttId })
        events.push(event)
      }

      if (!outdated) {
        const alpha = o.moodAlpha * damp(reading.thin)
        for (const id of MOOD_IDS) {
          const strength = reading.mood.strength[id] ?? 0
          ema[id] = (1 - alpha) * ema[id] + alpha * strength
          if (strength >= o.moodSeenMin && id !== 'none') (moodSeen[id] ??= new Map()).set(ctx.uttId, now)
        }
        events.push(...syncMood(now))
      }
      return { events, verdict: { cue, telop, mood: { active: mood.active, ema: { ...ema } } } }
    },

    /** 定期的に呼ぶ。黙っているあいだのムードの減衰、最長保持、待たせていた声の切替。 */
    tick({ speaking: isSpeaking = false, lastSpeechAt = -Infinity } = {}, now) {
      speaking = isSpeaking
      const dt = lastTickAt == null ? 0 : now - lastTickAt
      lastTickAt = now
      if (now - lastSpeechAt > o.silenceMs && dt > 0) {
        const keep = Math.exp(-dt / o.silenceTauMs)
        for (const id of MOOD_IDS) ema[id] *= keep
      }
      return syncMood(now)
    },

    /** 手動発火。ボタンやキーから、しきい値も間隔も見ずに出す。 */
    force(cueId, now, heat = 0.6, telop = null) {
      if (cueId && !CUE_BY_ID[cueId]) return []
      return [oneshot({ cue: cueId && cueId !== 'none' ? cueId : null, telop, heat, ctx: null, now, why: null })].filter((e) => e.cue || e.telop)
    },

    /** 字幕を消したとき。出ている持続系をすべて下ろすイベントを返す。 */
    reset(now) {
      const events = [...applied.values()].map((e) => ({ kind: 'ambient', at: now, layer: e.layer, id: e.id, on: false, intensity: 0, mood: 'none' }))
      lastSeq = -Infinity
      fired = { cue: null, telop: null }
      ema = Object.fromEntries(MOOD_IDS.map((id) => [id, 0]))
      mood = { active: 'none', since: -Infinity }
      moodSeen = {}
      applied = new Map()
      heldVoice = null
      return events
    },

    snapshot() {
      return { mood: { ...mood, ema: { ...ema } }, layers: [...applied.values()], heldVoice: Boolean(heldVoice) }
    },
  }
}
