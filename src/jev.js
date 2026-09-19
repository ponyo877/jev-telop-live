// TypeSafe 公式の API での Jev 呼び出し。DOM に依存しないので Node からも使える。
// 仕様は https://docs.typesafe.ai/api と https://docs.typesafe.ai/models。chat/completions ではなく、state と型つきの問いを送る専用のエンドポイント。

export const DECISIONS_URL = 'https://api.typesafe.ai/v1/systemone'
// 別名の jev-latest は、新しい版が出ると黙ってそちらへ切り替わる。director のしきい値は 1.13 で測って決めたので、版を固定する。
// 版を上げるときは sim/probe.js で測り直す
export const DEFAULT_MODEL = 'jev-1.13.0'
// 応答の usage にはトークン数しか入っていないので、費用はここで計算する。料金は入力 100 万トークンあたりのドルで、出力は無料
export const PRICE_PER_MTOK = 0.042

/** usage に cost（ドル）を足す。 */
const withCost = (usage) => (usage ? { ...usage, cost: usage.cost ?? ((usage.input_tokens ?? 0) * PRICE_PER_MTOK) / 1e6 } : null)

export class JevError extends Error {
  constructor(message, { status = 0, fatal = false } = {}) {
    super(message)
    this.name = 'JevError'
    this.status = status
    /** キーや権限の問題、送った内容の誤り。直すまで呼び続けても無駄なもの。 */
    this.fatal = fatal
  }
}

/**
 * エラーの本文から説明を取り出す。TypeSafe の API は detail に入れて返す。
 *   401: { detail: { error_type, message } }
 *   422: { detail: [{ loc: ['body', 'questions'], msg: 'Field required' }, ...] }
 */
function detailOf(body) {
  const detail = body?.detail ?? body?.error ?? body?.message
  if (detail == null) return ''
  const text = Array.isArray(detail)
    ? detail.map((d) => `${(d.loc ?? []).filter((part) => part !== 'body').join('.')}: ${d.msg ?? JSON.stringify(d)}`).join('; ')
    : typeof detail === 'string'
      ? detail
      : (detail.message ?? JSON.stringify(detail))
  return ` (${text})`.slice(0, 300)
}

function explain(status, body) {
  const detail = detailOf(body)
  if (status === 401) return `The API key did not work.${detail}`
  if (status === 402 || status === 403) return `This API key is not allowed to call Jev.${detail}`
  if (status === 404) return `Model not found.${detail}`
  if (status === 422) return `Jev rejected the request as invalid.${detail}`
  if (status === 429) return 'Too many calls. Rate limit hit.'
  if (status === 529) return 'Jev is overloaded right now.'
  return `Jev error: HTTP ${status}.${detail}`
}

/** 間を置いて試し直せば通るもの。すぐ 2 本目を投げても、同じ結果になるか、混雑を悪くするだけ。 */
export const isBusy = (status) => status === 429 || status === 529

async function request({ url, apiKey, body, timeoutMs, fetchImpl }) {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      // apiKey が空なのは server.js の中継を使うとき。キーは中継側が付ける。
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
      body,
      // 期限は要求ごとに持つ。2 本目を投げたあとも、負けた側が期限なしで残らないように
      signal: AbortSignal.timeout(timeoutMs),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      throw new JevError(explain(res.status, json), {
        status: res.status,
        // 422 は送った内容の誤り。同じ内容を送り直しても通らない
        fatal: [401, 402, 403, 404, 422].includes(res.status),
      })
    }
    if (!json?.answers) throw new JevError('Jev sent no answers.')
    return { answers: json.answers, usage: withCost(json.usage), model: json.model ?? null }
  } catch (err) {
    if (err instanceof JevError) throw err
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new JevError(`Jev did not reply in ${timeoutMs} ms.`)
    throw new JevError(`Can't reach Jev: ${err?.message ?? err}.`)
  }
}

/**
 * state と質問を 1 リクエストで送る。Jev は全質問を並列に評価する。
 *
 * 応答はふだん数百 ms だが、まれに何秒も返らない。hedgeAfterMs たっても返らなければ同じ要求をもう 1 本投げ、
 * 先に成功したほうを採る（ヘッジ）。送る内容は同じなので、判断は変わらない。
 *   - キーや内容の問題（fatal）と、レート制限（429）や過負荷（529）では 2 本目を投げない。投げても同じ結果になるか、混雑を悪くする。
 *   - それ以外の失敗がすぐ返ってきたら、待たずに 2 本目を投げる。
 *   - 負けた要求は止めない。あとで届いた usage は onLateUsage に渡すので、呼び出し側は費用を取りこぼさない。
 * latencyMs は最初の要求を投げてからの実時間。ヘッジが勝っても短く見せない。
 */
export function askJev({ apiKey, url = DECISIONS_URL, model = DEFAULT_MODEL, state, questions, timeoutMs = 4000, hedgeAfterMs = 1200, onLateUsage, fetchImpl = fetch }) {
  const started = performance.now()
  const body = JSON.stringify({ model, state, questions })

  return new Promise((resolve, reject) => {
    const errors = []
    let settled = false
    let hedged = false
    let outstanding = 0
    let timer = null

    const launch = (attempt) => {
      outstanding++
      request({ url, apiKey, body, timeoutMs, fetchImpl }).then(
        (res) => {
          outstanding--
          if (settled) {
            onLateUsage?.(res.usage)
            return
          }
          settled = true
          clearTimeout(timer)
          resolve({ ...res, latencyMs: Math.round(performance.now() - started), hedged, attempt })
        },
        (err) => {
          outstanding--
          if (settled) return
          errors.push(err)
          const hopeless = err.fatal || isBusy(err.status)
          if (!hedged && !hopeless && hedgeAfterMs != null) {
            hedge()
            return
          }
          if (outstanding > 0) return
          settled = true
          clearTimeout(timer)
          reject(errors.find((e) => e.fatal) ?? errors[0])
        },
      )
    }

    const hedge = () => {
      clearTimeout(timer)
      if (settled || hedged) return
      hedged = true
      launch(2)
    }

    launch(1)
    if (hedgeAfterMs != null) timer = setTimeout(hedge, hedgeAfterMs)
  })
}
