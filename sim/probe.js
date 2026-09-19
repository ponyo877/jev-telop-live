// 実 API での下調べ。director のしきい値や state の形は、ここで測った値から決める。
//   TYPESAFE_API_KEY=... node sim/probe.js [none|interim|heat|state|facts|burst|style|all=none,interim,heat,style]
//   none     ふつうの話で cue と mood が none に落ちるか。台本の行で期待の演出が上位に来るか。choice だけの場合と noul を掛けた場合の比較
//   interim  オチのある行を 3 文字ずつ伸ばして送り、言い切る前にオチと演出が立ってしまわないか、言い切ったら立つか
//   heat     同じ内容を熱量だけ変えて送り、score が順に上がるか。答えの形（probabilities が配列か、番号キーか）
//   state    オチの直後にふつうの話が続くとき、判定の対象を 1 つに絞る渡し方と、3 つに分けて渡す方とで、オチの値がどう違うか
//   facts    話し方の事実（速さ、間）が熱量に効くか。効かないなら送るだけ無駄
//   burst    1 秒に 2 回を 15 秒続けて、応答時間と 429 の有無を見る
//   style    発話テロップの様式が、ツッコミや自虐を選び分けるか

import { buildQuestions, buildState, readAnswers, top } from '../src/ask.js'
import { askJev, isBusy } from '../src/jev.js'
import { HEAT_LADDER, NEUTRAL, SCRIPT, sleep } from './script.js'

const apiKey = process.env.TYPESAFE_API_KEY
if (!apiKey) {
  console.error('TYPESAFE_API_KEY を設定してください')
  process.exit(1)
}

const questions = buildQuestions()
const totals = { calls: 0, cost: 0, latencies: [] }

async function ask(state, extra = {}) {
  // ヘッジは切る。応答時間をそのまま測りたい
  const res = await askJev({ apiKey, state, questions, timeoutMs: 15000, hedgeAfterMs: null, ...extra })
  totals.calls++
  totals.cost += res.usage?.cost ?? 0
  totals.latencies.push(res.latencyMs)
  return { ...res, reading: readAnswers(res.answers) }
}

const f = (v) => (typeof v === 'number' ? v.toFixed(2) : ' – ')
const top3 = (dist) => top(dist, 3).map(([id, p]) => `${id} ${f(p)}`).join('  ')
const finished = (text, context = '') => buildState({ earlier: context, latest: text })
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1]

const experiments = {
  async none() {
    console.log('\n== none: ふつうの話で何も出さないか ==')
    let choiceOnly = 0
    let fused = 0
    for (const text of NEUTRAL) {
      const { reading: r } = await ask(finished(text))
      const byChoice = top(r.cue.choice, 1)[0]
      if (byChoice[0] !== 'none' && byChoice[1] >= 0.5) choiceOnly++
      if (r.cue.top !== 'none' && r.cue.strength[r.cue.top] >= 0.5) fused++
      console.log(`  ${text.slice(0, 24).padEnd(26, '　')} choice: ${top3(r.cue.choice).padEnd(40)} 掛けた後: ${top3(r.cue.strength)}   乏 ${f(r.thin)}  mood ${r.mood.top}`)
    }
    console.log(`  → 0.5 以上で誤って出る行: choice だけ ${choiceOnly}/${NEUTRAL.length}、noul を掛けると ${fused}/${NEUTRAL.length}`)

    console.log('\n== none: 台本の行で、期待の演出が上位 3 つに入るか ==')
    let hits = 0
    let expected = 0
    let context = ''
    for (const { text, expect } of SCRIPT) {
      const { reading: r } = await ask(finished(text, context))
      context = text
      const best = top(r.cue.strength, 3).map(([id]) => id)
      const want = expect.cue ?? []
      const ok = want.length ? want.some((id) => best.includes(id)) : null
      if (ok != null) expected++
      if (ok) hits++
      console.log(`  ${ok == null ? '  ' : ok ? '○ ' : '✗ '}${text.slice(0, 22).padEnd(24, '　')} ${top3(r.cue.strength).padEnd(40)} オチ ${f(r.punchline)}  熱 ${f(r.heat)}  乏 ${f(r.thin)}  期待 ${want.join('/') || '-'}${expect.punch ? ' オチ' : ''}`)
    }
    console.log(`  → ${hits}/${expected}`)
  },

  async interim() {
    console.log('\n== interim: 言い切る前にオチが立ってしまわないか ==')
    for (const { text } of SCRIPT.filter((l) => l.expect.punch)) {
      console.log(`  「${text}」`)
      for (let n = 6; n <= text.length + 2; n += 3) {
        const part = text.slice(0, n)
        const done = n >= text.length
        const state = buildState({ earlier: '', latest: '', speakingNow: part }, {}, { paused: done })
        const { reading: r } = await ask(state)
        console.log(`    ${done ? '止' : '伸'} ${part.padEnd(text.length + 1, '　')} オチ ${f(r.punchline)}  言い切り ${f(r.complete)}  乏 ${f(r.thin)}  ${top3(r.cue.strength)}`)
        if (done) break
      }
    }
  },

  async heat() {
    console.log('\n== heat: 熱量が順に上がるか ==')
    let shape = null
    for (const text of HEAT_LADDER) {
      const { answers, reading: r } = await ask(finished(text))
      shape ??= answers.heat
      const d = r.heatDetail
      console.log(`  ${text.slice(0, 22).padEnd(24, '　')} 熱量 ${f(r.heat)}  score ${f(d.score)}  confidence ${f(d.confidence)}  分布 ${d.levels?.map((p) => p.toFixed(2)).join(' ') ?? '-'}`)
    }
    console.log(`  答えの形: ${JSON.stringify(shape)}`)
  },

  async state() {
    console.log('\n== state: オチの直後のふつうの話で、オチの値が下がるか ==')
    const punch = 'いやなんでやねん、箱だけ売るなよ'
    const next = 'それでですね、次に設定の画面を開きます'
    const ours = await ask(buildState({ earlier: '届いて箱を開けたら、中身が空っぽだったんです', latest: punch, speakingNow: next }))
    // 脳内メーカーと同じ 3 分割。確定した行と話している途中の字幕を、並べて渡す
    const three = {
      ...buildState({}),
      transcript: { earlier: '届いて箱を開けたら、中身が空っぽだったんです', latest: punch, speaking_now: next },
    }
    const theirs = await ask(three)
    console.log(`  判定の対象を 1 つに絞る（本作）: オチ ${f(ours.reading.punchline)}  ${top3(ours.reading.cue.strength)}`)
    console.log(`  3 つに分けて渡す（脳内メーカー）: オチ ${f(theirs.reading.punchline)}  ${top3(theirs.reading.cue.strength)}`)
    console.log('  → 次の発話はふつうの話なので、オチも演出も低いほうが正しい')
  },

  async facts() {
    console.log('\n== facts: 話し方の事実が熱量に効くか ==')
    for (const text of ['これ、けっこういいと思います', 'いやなんでやねん、箱だけ売るなよ']) {
      for (const delivery of [{ pace: 'unknown', pause_before: 'unknown' }, { pace: 'fast', pause_before: 'none' }, { pace: 'slow', pause_before: 'long' }]) {
        const { reading: r } = await ask(buildState({ latest: text }, delivery))
        console.log(`  ${text.slice(0, 18).padEnd(20, '　')} ${`${delivery.pace}/${delivery.pause_before}`.padEnd(16)} 熱量 ${f(r.heat)}  オチ ${f(r.punchline)}`)
      }
    }
  },

  async burst() {
    console.log('\n== burst: 1 秒に 2 回を 15 秒 ==')
    const before = totals.latencies.length
    let limited = 0
    const jobs = []
    for (let i = 0; i < 30; i++) {
      const text = SCRIPT[i % SCRIPT.length].text
      jobs.push(ask(finished(text)).catch((err) => (limited += isBusy(err.status) ? 1 : 0, console.log(`  ! ${err.message}`))))
      await sleep(500)
    }
    await Promise.all(jobs)
    const mine = totals.latencies.slice(before)
    console.log(`  応答時間: 中央値 ${median(mine)} ms  最大 ${Math.max(...mine)} ms  （${mine.length}/30 件成功、429 と 529 は ${limited} 件）`)
  },

  async style() {
    console.log('\n== style: 発話テロップの様式 ==')
    const lines = [
      ['いやなんでやねん、箱だけ売るなよ', 'tsukkomi'],
      ['どうせ俺なんて、誰からも必要とされてないんですよ', 'sad'],
      ['優勝したのは、この俺だ！', 'impact / cool'],
      ['うしろに、誰か立ってる…', 'horror'],
      ['おなかすいたにゃん', 'cute / funny'],
      ['会議は3時からです', 'plain'],
    ]
    for (const [text, want] of lines) {
      const { reading: r } = await ask(finished(text))
      console.log(`  ${text.slice(0, 22).padEnd(24, '　')} ${top3(r.styles).padEnd(44)} 期待 ${want}`)
    }
  },
}

const arg = process.argv[2] ?? 'all'
const names = arg === 'all' ? ['none', 'interim', 'heat', 'style'] : arg.split(',')
for (const name of names) {
  if (!experiments[name]) {
    console.error(`知らない実験: ${name}（${Object.keys(experiments).join(' / ')}）`)
    process.exit(1)
  }
  await experiments[name]()
}
console.log(`\n問い ${Object.keys(questions).length} 個  呼び出し ${totals.calls} 回  応答時間 中央値 ${median(totals.latencies)} ms / 最大 ${Math.max(...totals.latencies)} ms  費用 $${totals.cost.toFixed(5)}（1 回 $${(totals.cost / totals.calls).toFixed(5)}）`)
