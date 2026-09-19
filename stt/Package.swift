// swift-tools-version: 6.2
import Foundation
import PackageDescription

// マイクの利用目的を書いた Info.plist を、実行ファイルの中に埋め込む。
// コマンドラインツールにはアプリのような bundle が無いので、こうしないと macOS が許可ダイアログを出せない。
let plist = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Info.plist").path

let package = Package(
  name: "stt",
  platforms: [.macOS(.v26)],
  targets: [
    .executableTarget(
      name: "stt",
      path: "Sources/stt",
      swiftSettings: [.swiftLanguageMode(.v5)],
      linkerSettings: [
        .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", plist]),
      ]
    ),
  ]
)
