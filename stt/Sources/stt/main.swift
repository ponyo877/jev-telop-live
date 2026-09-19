// マイクの音声を日本語の字幕にして、stdout へ 1 行 1 JSON で出す。server.js がこれを読んでブラウザへ流す。
//   {"type":"status","text":"..."}   準備の進み具合
//   {"type":"ready"}                 聞き始めた
//   {"type":"interim","text":"..."}  認識途中。次の interim か final で置き換わる
//   {"type":"final","text":"..."}    確定
//   {"type":"error","code":"denied"|"failed","text":"..."}
// 認識は Apple の SpeechAnalyzer（macOS 26 以降）。この Mac の中だけで動き、音声を外へ送らない。
//   stt                 マイクから
//   stt --file a.aiff   音声ファイルから（マイクなしでの動作確認用）

import AVFoundation
import Foundation
import Speech

func emit(_ fields: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: fields),
        let line = String(data: data, encoding: .utf8) else { return }
  print(line)
  fflush(stdout)
}

func fail(_ text: String, code: String = "failed") -> Never {
  emit(["type": "error", "code": code, "text": text])
  exit(code == "denied" ? 2 : 1)
}

let arguments = CommandLine.arguments
let filePath: String? = arguments.firstIndex(of: "--file").flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil }

guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: "ja-JP")) else {
  fail("この Mac の音声認識は日本語に対応していません")
}

// progressiveTranscription は、確定前の途中結果（volatile results）も返すプリセット
let transcriber = SpeechTranscriber(locale: locale, preset: .progressiveTranscription)

do {
  if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
    emit(["type": "status", "text": "日本語の音声モデルを確認中"])
    try await request.downloadAndInstall()
  }
} catch {
  fail("日本語の音声モデルを用意できませんでした: \(error.localizedDescription)")
}

let analyzer = SpeechAnalyzer(modules: [transcriber])
var engine: AVAudioEngine?

if let filePath {
  do {
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: filePath))
    try await analyzer.start(inputAudioFile: file, finishAfterFile: true)
  } catch {
    fail("音声ファイルを読めませんでした: \(error.localizedDescription)")
  }
} else {
  guard await AVCaptureDevice.requestAccess(for: .audio) else {
    fail("マイクの使用が許可されていません。システム設定 > プライバシーとセキュリティ > マイク で、起動元のターミナルを許可してください", code: "denied")
  }
  guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
    fail("音声認識が受け取れる音声形式がありません")
  }

  let audio = AVAudioEngine()
  let input = audio.inputNode
  let inputFormat = input.outputFormat(forBus: 0)
  guard inputFormat.sampleRate > 0, let converter = AVAudioConverter(from: inputFormat, to: format) else {
    fail("マイクが見つかりません")
  }

  let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
  // マイクの形式（多くは 48kHz Float32）を、認識器が求める形式（16kHz Int16 など）に直してから渡す
  input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { buffer, _ in
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * format.sampleRate / inputFormat.sampleRate) + 32
    guard let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
    var handed = false
    var problem: NSError?
    let status = converter.convert(to: converted, error: &problem) { _, inputStatus in
      if handed {
        inputStatus.pointee = .noDataNow
        return nil
      }
      handed = true
      inputStatus.pointee = .haveData
      return buffer
    }
    if status != .error, converted.frameLength > 0 { continuation.yield(AnalyzerInput(buffer: converted)) }
  }

  do {
    audio.prepare()
    try audio.start()
    try await analyzer.start(inputSequence: stream)
  } catch {
    fail("マイクを開始できませんでした: \(error.localizedDescription)")
  }
  engine = audio
}

emit(["type": "ready"])

do {
  for try await result in transcriber.results {
    let text = String(result.text.characters)
    if text.isEmpty { continue }
    emit(["type": result.isFinal ? "final" : "interim", "text": text])
  }
} catch {
  fail("音声認識が止まりました: \(error.localizedDescription)")
}
engine?.stop()
