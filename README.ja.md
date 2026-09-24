# markport

AI Agent が作った Markdown とコードを、ローカルのブラウザで読むための CLI です。選んだディレクトリを読み取り専用で表示します。Markdown の表・タスクリスト・Mermaid 図、コードの色付け、相対リンク・画像、ファイル変更の自動反映に対応します。

## 使い方

GitHub Release から OS・CPU に合う実行ファイルを選びます。Linux、macOS、Windows の `amd64`（x64）と `arm64` を用意します。Windows 版は `.exe` です。利用時に Go、Node.js、npm や別置きの Web アセットは不要です。ブラウザは別途必要です。

Release の `checksums_<version>.txt` をダウンロードし、バイナリと同じフォルダで Linux は `sha256sum --check checksums_<version>.txt`、macOS は `shasum -a 256 -c checksums_<version>.txt` でハッシュを確認できます。Windows では `Get-FileHash` で個別に確認できます。

```sh
./markport_v1.0.0_linux_amd64 ./notes --port 3000
./markport_v1.0.0_linux_amd64 --help
./markport_v1.0.0_linux_amd64 --version
```

引数を省略すると現在のディレクトリをポート 3000 で表示します。起動後に表示される `http://127.0.0.1:<port>/` を開いてください。`Ctrl+C` で終了します。待ち受け先はローカル端末の `127.0.0.1` に固定されています。

`.git`、`node_modules`、`.venv` は表示と監視から除外します。その他のドットファイルは表示します。シンボリックリンク、Windows のジャンクション、FIFO などの特殊ファイルは読まず、テキストは 10 MiB までです。バイナリや読めないファイルはそのファイルだけエラーを表示します。自動更新が切れた場合は画面の「再読み込み」を押せます。

## 開発

Go 1.27、Node.js 24、npm、Make を使います。devcontainer はポート 3000 と 5173 を転送します。

```sh
make setup                 # Go と npm の依存関係
make dev DIR=./testdata    # Go API と Vite 開発サーバー。Vite は localhost:5173
make build VERSION=dev     # 現在の OS・CPU 向け実行ファイル
make run DIR=./testdata PORT=3000
make test                  # Go と画面のテスト
make test-e2e             # Chromium の画面受け入れテスト（Playwright のブラウザ導入が必要）
make lint                  # go vet、TypeScript、ESLint
make dist VERSION=v1.0.0  # 6 種類と SHA-256 チェックサム
```

`make setup` の後に `make lint` を単独で実行できます。画面は各 Make タスクでビルドされ、実行ファイルへ埋め込まれます。開発画面の API は Vite から Go へプロキシされます。

ブラウザの受け入れテストを初回に実行する前に、`cd web && npx playwright install --with-deps chromium` で Chromium と実行に必要なライブラリを導入します。

`v*` タグを push すると GitHub Actions が各 OS で検証してから、既存タグに対して Release を作成します。リリース実行前に `make test`、`make lint`、`make dist VERSION=<tag>` をローカルでも確認できます。コード署名と macOS の公証は初版では行いません。

初版に編集、コメント、差分表示、本文全文検索、標準入力からの取り込み、認証付きのネットワーク公開は含めません。
