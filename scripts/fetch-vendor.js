// 顔認識（MediaPipe）の実行ファイルとモデルを vendor/mediapipe/<VERSION>/ に落とす。回線の無い配信現場でも顔エフェクトを動かすため。
// 使い方: node scripts/fetch-vendor.js [--force]
// 版と取得先は src/stage/face-urls.js にある（ブラウザ側と同じ定義を読むので、食い違わない）。vendor/ は gitignore 済み。

import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VENDOR_FILES, VERSION } from '../src/stage/face-urls.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEST = join(ROOT, 'vendor', 'mediapipe', VERSION)
const FORCE = process.argv.includes('--force')

const mb = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`
const sizeOf = (file) => stat(file).then((s) => s.size, () => 0)

async function download(url, file) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  // 圧縮されて届くときの Content-Length は展開前の大きさなので、進み具合の分母には使えない。
  const total = res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length') ?? 0)
  // 途中で切れたものを完成品と見間違えないよう、別名で書ききってから置き換える。
  const part = `${file}.part`
  await mkdir(dirname(file), { recursive: true })
  const out = createWriteStream(part)
  let bytes = 0
  try {
    for await (const chunk of res.body) {
      bytes += chunk.length
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve))
      if (process.stdout.isTTY) process.stdout.write(`\r    ${mb(bytes)}${total ? ` / ${mb(total)}` : ''}  `)
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())))
    if (!bytes || (total && bytes !== total)) throw new Error(`${bytes} バイトで切れた`)
    await rename(part, file)
  } catch (e) {
    out.destroy()
    await rm(part, { force: true })
    throw e
  } finally {
    if (process.stdout.isTTY) process.stdout.write('\r\x1b[K')
  }
  return bytes
}

console.log(`@mediapipe/tasks-vision ${VERSION} → ${DEST}`)
let sum = 0
for (const { path, url } of VENDOR_FILES) {
  const file = join(DEST, path)
  const have = FORCE ? 0 : await sizeOf(file)
  if (have) {
    console.log(`  ある   ${path}  ${mb(have)}`)
    sum += have
    continue
  }
  console.log(`  取得   ${path}  ← ${url}`)
  try {
    const bytes = await download(url, file)
    console.log(`  保存   ${path}  ${mb(bytes)}`)
    sum += bytes
  } catch (e) {
    console.error(`  失敗   ${path}: ${e.message}`)
    console.error('やり直すには、もう一度実行する（取れたファイルは飛ばす）。')
    process.exit(1)
  }
}
console.log(`合計 ${mb(sum)}。次に npm start すると、ブラウザは CDN ではなく /vendor/mediapipe/${VERSION}/ から読む。`)
