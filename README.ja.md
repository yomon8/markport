# markport

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="logo/markport-logo-horizontal-dark.svg">
  <img src="logo/markport-logo-horizontal-light.svg" alt="Markport のロゴ" width="300">
</picture>

[English](README.md) · [リポジトリ](https://github.com/yomon8/markport) · [リリース](https://github.com/yomon8/markport/releases)

Markport は、指定したフォルダの Markdown・HTML・コード・画像・PDF をブラウザでまとめて確認できる CLI ツールです。AI エージェントが作った文書やファイルの確認にも便利です。ディレクトリを指定するだけでローカルに配信し、ファイルは読み取り専用で一切書き換えません。

![Markdown と本文検索の結果を表示した Markport](docs/screenshots/content-search.png)

## 主な機能

- **ファイルを見ながらたどる：** フォルダを開き、相対リンクや画像をたどれます。Markdown・HTML・PDF と SVG・PNG・JPEG・GIF・WebP 画像をプレビューできます。Markdown は表・タスクリスト・コードの色付け・Mermaid 図・LaTeX 数式・目次に対応し、Markdown と HTML はソース表示にも切り替えられます。
- **2つのファイルを見比べる：** 分割表示で2つ目のファイルを開けます。左右は独立してスクロール・自動更新されます。
- **必要な箇所を探す：** ファイル名・パスの検索、本文の検索に加え、`path/to/file.md:123` の形式で指定行へ直接移動できます。
- **Git の変更を確認する：** 変更ファイルと差分を表示し、HEAD や過去のコミットと比較できます。どのファイルを確認済みかも記録できます。
- **Git の履歴をたどる：** 現在のフォルダを変更したコミットと、ファイルごとの差分を確認できます。
- **更新や貼り付けをすぐに確認する：** 表示中のファイルは変更を自動反映します。クリップボードの Markdown を貼り付けて、ファイルを作らずにプレビューすることもできます。
- **印刷・PDF 保存：** 図や数式を描画した状態で Markdown を印刷できます。
- **単一の実行ファイル：** Go・Node.js や別置きの Web アセットは不要で、ブラウザだけで使えます。

[Git の変更確認](docs/screenshots/reviewed-changes.png) · [分割表示](docs/screenshots/split-view.png) · [貼り付けた Markdown](docs/screenshots/pasted-markdown.png) · [ダークテーマ](docs/screenshots/content-search-dark.png) · [モバイル表示](docs/screenshots/mobile.png)

## 目次

- [インストール](#インストール)
- [クイックスタート](#クイックスタート)
- [使い方](#使い方)
- [更新](#更新)
- [LAN からのアクセスとセキュリティ](#lan-からのアクセスとセキュリティ)
- [制限と自動更新の動作](#制限と自動更新の動作)
- [開発](#開発)

## インストール

### Linux インストーラ

CPU に合う最新リリースをインストールします。

```sh
(
  installer=$(mktemp) || exit
  trap 'rm -f "$installer"' 0
  trap 'exit 1' 1 2 3 15
  curl -fsSLo "$installer" https://raw.githubusercontent.com/yomon8/markport/main/scripts/install-linux.sh &&
    sh "$installer"
)
```

導入先は `~/.local/bin/markport` で、インストーラのファイルは残りません。置き換え前にリリースのチェックサムを確認するため、ダウンロードや検証に失敗しても既存のバージョンは残ります。同じコマンドを再実行すると最新版に更新できます。必要に応じて `~/.local/bin` を `PATH` に追加してください。

### 手動ダウンロード

[GitHub Releases](https://github.com/yomon8/markport/releases) から OS・CPU に合う実行ファイルをダウンロードします。Linux・macOS・Windows の `amd64`（x64）と `arm64` を用意しており、Windows 版は `.exe` です。リリース実行ファイルにはコード署名と macOS の公証を行っていません。

ダウンロードしたファイルを検証するには、リリースの `checksums_<version>.txt` を実行ファイルと同じフォルダに置いて次を実行します。

```sh
sha256sum --check checksums_<version>.txt      # Linux
shasum -a 256 -c checksums_<version>.txt       # macOS
```

Windows では `Get-FileHash` で個別に確認できます。Linux・macOS では、ファイル名を `markport` に変更し、`chmod +x markport` で実行権限を付けてください。

## クイックスタート

```sh
markport ./notes
```

起動時に表示される `http://127.0.0.1:3000/` をブラウザで開きます。フォルダを省略すると現在のディレクトリを表示します。終了するときは `Ctrl+C` を押します。

| オプション | 説明 |
| --- | --- |
| `[directory]` | 閲覧するフォルダ。省略時は現在のディレクトリ |
| `--host IPv4` | 待ち受けアドレス。既定は `127.0.0.1`。[LAN からのアクセス](#lan-からのアクセスとセキュリティ)を参照 |
| `--port PORT` | 待ち受けポート。既定は `3000` |
| `--title TEXT` | ブラウザのタブタイトルを固定。[タブタイトル](#ブラウザのタブタイトル)を参照 |
| `--help` | 使い方を表示 |
| `--version` | バージョンを表示 |
| `--check-update`、`--update` | 新しいリリースの確認・導入。[更新](#更新)を参照 |

`--port=8080` のような `--name=value` 形式も使えます。

## 使い方

### ファイルの移動と検索

ファイルのパンくずにあるフォルダを押すとサイドバーでその場所を表示し、**Search files** 横の **Collapse all** で開いているフォルダをすべて折りたためます。サイドバーの境界をドラッグすると幅を調整できます。見出しが3つ以上ある Markdown では **Contents**（目次）を表示し、現在読んでいる節を強調します。

**Search files** は、閉じたフォルダ内も含めてファイル名・パスを検索します。Git の無視対象ファイルも検索できますが、他の一致結果より下位に表示します。`path/to/file.md:123` のように正の行番号を付けるとその行へ移動します。Markdown と HTML の行指定は **Source** 表示で開きます。

**Search contents** を開き、**Text to find** に検索語を入力します。**Folder** には閲覧ディレクトリからの相対パスを指定でき、空欄なら全体を検索します。結果には一致行と前後の文脈を表示し、押すとその行を開きます。**Cancel** で検索を中止できます。検索の上限に達した場合は、どの上限に達したかと結果が一部であることを表示します。

### 分割表示

サイドバーのファイルや検索結果の横にある矢印で、右側にファイルを開けます。左右は独立してスクロール・自動更新されます。**Swap panes** で左右を入れ替え、**Show this file only** で右のファイルだけを表示し、**Close split view** で左のファイルだけの表示に戻ります。狭い画面では上下に並びます。

### コード・表・図・数式

コードブロックやソース表示の **Wrap lines** で長い行を折り返し、**Copy** でコードをコピーできます。Markdown の表には原文の Markdown をコピーする **Copy** があり、横に長い表には **Wrap cells** と **Expand** も表示します。横に長い表は水平スクロールでき、隠れた部分がある場合は端に目印を表示します。折り返し設定はブラウザに保存され、分割表示の両ペインと貼り付けた Markdown にも適用されます。

Mermaid 図には **Copy**、**Source**、**Expand** があります。Copy はコードフェンスを除いた図の定義文をコピーします。拡大表示ではドラッグで移動し、ズームボタンやピンチ操作で拡大・縮小できます。**Fit diagram** で表示領域に合わせ、**100%** で等倍に戻します。

数式は同梱の KaTeX で描画し、CDN やインターネット接続は不要です。Markdown の通常表示・分割表示の両ペイン・**Paste Markdown** で使えます。インライン数式は `$E=mc^2$` または `\(E=mc^2\)`、独立した数式は `$$E=mc^2$$` または `\[E=mc^2\]` で記述し、複数行にもできます。

```markdown
$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$
```

- 数式の内容は Markdown として解釈しません。インラインコードとコードブロック内はそのまま表示します。
- ドル記号そのものは `\$` と書きます。単一ドル記号の数式は、区切りのすぐ内側に空白を入れず、閉じ `$` の直後に数字を置かないでください。
- Markdown の表内では、数式中の `|` を `\vert` と書いてください。
- 分数・積分・行列・`aligned` などの一般的な命令に対応します。`.tex` 文書のコンパイルや任意のパッケージの読み込みは行いません。
- HTML プレビューと `math` コードブロックは対象外です。

独立した数式の **Copy** は、`$$…$$` または `\[…\]` の区切りを含む元の TeX をコピーします。図や数式を描画できない場合は元の記法とエラーを表示し、ソースはコピーでき、文書の他の部分も表示を続けます。コピー結果は **Copied** または **Copy failed** で一時的に表示します。これらの操作ボタンは印刷結果には含まれません。

### HTML と PDF のプレビュー

HTML プレビューでは、閲覧ディレクトリ内の相対パスの CSS・画像と、外部 URL の CSS・画像を読み込みます。JavaScript は初期状態では実行しません。信頼する HTML で **Enable JavaScript** を押すと、インラインとローカルのスクリプトによる操作や印刷を利用できます。設定はそのファイルについて現在のタブ内で保持され、**Disable JavaScript** を押すか、タブを閉じるか、Markport を再起動すると解除されます。スクリプトは隔離されたプレビュー内で動き、外部スクリプト、fetch・WebSocket、フォーム送信、Markport 画面へのアクセスは許可しません。

PDF はブラウザ標準のビューアーで表示し、別タブで開いたりダウンロードしたりできます。

### 印刷と PDF 保存

ファイル操作、分割表示の各ペイン、または Paste Markdown の **Paste options** から **Print / Save as PDF** を選びます。Source・Text 表示からも利用できます。ダイアログには白背景の本文と描画済みの Mermaid 図・数式を表示します。準備ができたら **Print / Save as PDF** を押し、ブラウザの印刷画面で **PDF に保存** を選んでください。用紙サイズ・向き・ヘッダー／フッターの設定や、改ページの確認も印刷画面で行えます。

1回の操作で1文書を出力し、印刷用に読み込んだ時点の内容（Paste Markdown では操作時点の入力）を使います。描画エラーは警告とともに出力に含まれます。ダイアログを閉じると元の表示に戻ります。

### Markdown の貼り付け

**Paste Markdown** で、ファイルにない Markdown 用の全画面エディタを開きます。

- **Text** は記号を残したまま構文を色分けし、**Rendered** はプレビューを表示します。画面幅が 1200px 以上なら **Split** で両方を並べ、入力が少し止まるとプレビューを更新します。
- `Ctrl/Cmd+Enter` で Text と Rendered を切り替え、`Esc` でエディタからフォーカスを外します。Enter でリスト・タスクを継続し、`Tab` / `Shift+Tab` で選択行を2スペース単位でインデント・解除します。
- タイトルバーに文字数・行数・保存状態を表示します。**Paste options**（⋯）には、確認付きの **Clear**、**Copy all**、**Save as .md**、**Print / Save as PDF**、フォント・幅の設定、オプトインの **Save in this browser** があります。
- 既定では、文章とキャレット位置は同じタブでの再読み込み時に復元され、タブを閉じると消えます。**Save in this browser** を有効にするとタブを閉じても残るため、共有端末では使わないでください。再読み込み後は Text 表示で開きます。
- 保存・描画の上限は 1 MiB です。200 KiB を超えるとハイライトを止め、プレーンテキストとして編集を続けられます。
- 貼り付けた文章には基準フォルダがないため、相対リンクと画像は文字として表示します。描画のため Markport サーバーへ送信しますが、ファイルには保存しません。

### Git の変更確認と履歴

Git の表示には、Git のインストールと、閲覧ディレクトリが Git リポジトリ内にあることが必要です。サブフォルダを閲覧している場合、変更と履歴はそのフォルダ内に限定されます。

**Changes** は既定で作業中のファイルと HEAD を比較し、ステージ済み・未ステージ・未追跡の変更を表示します。比較元を変えるには、**Compare with current from** で最近のコミットを選ぶか、完全または短縮のコミット ID を入力して **Compare** を押します。**History** の **Compare with current** からも選べます。比較元は HEAD からたどれるコミットに限り、短縮 ID は一意に特定できる7文字以上の16進数で指定します。**Use HEAD** で既定に戻ります。

Changes の概要には、ファイル数・追加行数・削除行数・確認の進捗を表示します。**Folder tree** でフォルダごとにまとめ、**Unreviewed only** で未確認のファイルに絞れます。**Mark reviewed** はファイルの現在の内容を確認済みとして記録し、その後に変更されると未確認に戻ります。印はブラウザに、閲覧ルートと比較元ごとに保存されます。**Diff** 表示では **Previous**、**Next**、**Review and next**（または `p`、`n`、`r`）で順に確認できます。

**History** には現在のフォルダを変更したコミットを表示します。コミットごとの差分はそのコミットによる変更を、**Compare with current** はそのコミットと現在のディスク上のファイルとの差分を表示します。

### サーバー情報

ヘッダーの **Server info**（ⓘ）または `Ctrl+I` で、閲覧フォルダの絶対パス（シンボリックリンク解決後）、起動時の作業ディレクトリ、Markport のバージョン、接続先 URL を確認できます。

**Running Markport servers** には、同じホスト・同じ OS ユーザーで起動した Markport の閲覧フォルダ・接続先 URL・バージョンを表示します。現在のサーバーは先頭に **Current** 付きで表示します。フォルダのリンクを押すか、`↑` / `↓` で選んで `Enter` を押すと、同じタブでそのサーバーを開きます。**Refresh** で一覧を更新できます。

- リンクはローカル接続と直接の LAN 接続に対応します。LAN 接続時、ループバックアドレスだけで待ち受けるサーバーは **Local access only** と表示し、リンクにしません。
- 検出には、本機能に対応したバージョンで、ユーザーキャッシュディレクトリとネットワーク環境を共有している必要があります。別の OS ユーザー、独立したコンテナー、リバースプロキシ、トンネル経由は対象外です。
- 登録情報は OS ユーザーキャッシュディレクトリ内の `markport/instances` に保存し（閲覧フォルダには書き込みません）、正常終了時に削除します。停止したサーバーは稼働確認で除外します。検出に失敗しても、現在のサーバーの情報とエラーを表示します。

### カラーテーマ

ヘッダーの **Theme**（モバイルでは **App settings** 内）から選択します。

| テーマ | 特徴 |
| --- | --- |
| Auto | OS のライト／ダーク設定に追従 |
| Light / Dark | 標準の配色 |
| Sepia | 読書向けの暖色系 |
| Nord | 青灰色を基調としたダーク配色 |
| Catppuccin Mocha | 暗い背景にパステル色 |
| Solarized Light | クリーム色と青緑 |
| Rosé Pine Dawn | 暖かな紙の色 |
| Tokyo Night | 深い青に紫と青のアクセント |
| Tokyo Night Light | 涼しげなグレーに青と紫のアクセント |

コードの構文色、Git 差分、Mermaid 図にもテーマが適用されます。HTML プレビューは文書自身の配色を保ち、PDF と画像は元の見た目のまま表示します。選択はホスト・ポートごとにブラウザに保存されます。

[Sepia の画面](docs/screenshots/content-search-sepia.png) · [Nord の画面](docs/screenshots/content-search-nord.png)

### ブラウザのタブタイトル

起動時にタブタイトルを固定できます。

```sh
markport ./notes --title "作業ノート"
```

ヘッダーの **Title**（モバイルでは **App settings** 内）からも設定できます。ブラウザで保存したタイトルは `--title` より優先され、ファイルを切り替えても固定されます。閲覧フォルダと接続先（ホスト・ポート）ごとに保存され、同じ設定を使う他のタブにも反映し、再読み込みやサーバー再起動後も復元されます。**Reset** または空欄での保存で起動時のタイトルに戻ります。どちらも未設定なら、現在のファイル名や画面名を表示します。

### キーボードショートカット

`?` キーまたはヘッダーのヘルプボタンで、Markport 内にショートカット一覧を表示できます。macOS では `Ctrl` の代わりに `⌘` を使います。

| キー | 操作 |
| --- | --- |
| `/` または `Ctrl+K` | ファイル名検索へ移動 |
| `Ctrl+B` | ファイル一覧の開閉 |
| `Ctrl+I` | Server info を開く |
| `?` | ショートカット一覧を開く |
| `Esc` | ダイアログやメニューを閉じる／ファイル検索をクリア |
| `n` / `p` | Diff 表示で次／前の変更ファイルへ移動 |
| `r` | 確認済みにして次の未確認ファイルを開く |
| `↑` / `↓`、`Home` / `End`、`Enter` | ファイルツリー内を移動して開く |
| `←` / `→`、`Home` / `End` | サイドバーのタブを切り替える |
| `↑` / `↓`、`Enter` | Server info で稼働中のサーバーを選択して開く |
| `Ctrl+Enter`、`Tab` / `Shift+Tab`、`Esc` | Paste Markdown で表示切り替え・インデント・エディタから抜ける |

入力欄での編集中や日本語入力の変換中は、グローバルショートカットは反応しません。

## 更新

自己更新に対応したバージョンでは、次のコマンドで更新できます。

```sh
markport --check-update   # 現在版と最新の安定版を表示
markport --update         # 新しい安定版をダウンロード・検証して導入
```

- Linux・macOS・Windows の amd64／arm64 に対応します。各フラグは単独で使い、ディレクトリや他のオプションと併用しないでください。
- `--check-update` は実行ファイルのダウンロードやファイルへの書き込みを行いません。
- `--update` は `yomon8/markport` から新しい安定版を取得し、SHA-256 チェックサムと実行ファイルが報告するバージョンを検証してから、既存の実行ファイルを置き換えます。ファイル名は維持され、シンボリックリンクも引き続き同じ実行ファイルを指します。同じ版や古い版は導入しません。
- 通常の起動時に更新を確認することはありません。起動中のサーバーで新版を使うには手動で再起動してください。
- インストール先への書き込み権限が必要です。管理者権限を自動で要求することはありません。
- `dev` や `ci` など、バージョンが `vMAJOR.MINOR.PATCH` 形式でないビルドは確認のみ可能で、自己更新はできません。これらのフラグがない旧版からは、一度インストーラまたは手動ダウンロードで導入してください。
- 終了コードは、確認成功・更新完了・更新不要が `0`、失敗が `1`、引数エラーが `2` です。

<details>
<summary>失敗時の復旧について</summary>

ダウンロードや検証に失敗しても、既存の実行ファイルは残ります。Windows では旧ファイルを別名に退避してから新版を配置し、配置に失敗した場合は旧版の復元を試みます。起動中のプロセスにより旧ファイルを削除できない場合はそのパスを表示するので、旧プロセスがすべて終了した後に退避ファイルとその一時ディレクトリを削除してください。置き換え中に更新を強制終了して元のパスに実行ファイルがない場合は、隣接する `.<実行ファイル名>-update-*` ディレクトリ内の `previous.exe` を元のパスへ戻してください。復元に失敗した場合も復旧用のパスを表示します。更新の排他制御に使う小さな `.<実行ファイル名>.update.lock` ファイルはインストール先に残りますが、ロックは更新プロセスの終了時に解放されます。

</details>

## LAN からのアクセスとセキュリティ

既定では `127.0.0.1` でのみ待ち受けます。同じ LAN の端末から開くには、`--host 0.0.0.0`（または特定の IPv4 アドレス）で起動し、別端末で `http://<このマシンのLAN内IP>:<port>/` を開きます。

```sh
markport ./notes --host 0.0.0.0 --port 3000
```

> [!WARNING]
> LAN 公開には認証と TLS がありません。ポートに接続できる人は誰でも、除外対象以外のドットファイルも含めて、選択したディレクトリを閲覧できます。

## 制限と自動更新の動作

- `.git`、`node_modules`、`.venv` は表示から除外します。その他のドットファイルは表示します。
- シンボリックリンク、Windows のジャンクション、FIFO などの特殊ファイルは読みません。
- テキストは 10 MiB、画像は 32 MiB までです。バイナリや読めないファイルは、そのファイルだけエラーを表示します。
- フォルダは開いたときに200件ずつ読み込みます。ファイル名検索は閲覧対象の全ファイルを対象とし、上位100件を表示します。
- 開いたフォルダと表示中のファイルは約3秒ごとに確認し、検索中はファイル名一覧を約10秒ごとに更新します。閉じたフォルダは次に開いたときに更新します。ヘッダーの **Refresh** ですぐに再取得できます。

Markport には、ファイルの編集、コメント、標準入力からの取り込み、認証付きのネットワーク公開の機能はありません。

## 開発

### 構成

Go の実行ファイルが、組み込みのブラウザ UI と読み取り専用 API を指定した IPv4 アドレスで配信します。ファイルは必要なときに描画し、フォルダは1つずつ一覧します。

```mermaid
flowchart LR
    user["利用者"] -->|"ローカル URL を開く"| browser["ブラウザ UI"]
    browser <-->|"HTTP で定期確認"| server["Markport (Go)"]
    server -->|"選択中のファイルとフォルダを読み取り"| directory["選択したディレクトリ"]
```

| パス | 役割 |
| --- | --- |
| `cmd/markport/` | エントリポイント |
| `internal/cli/` | 引数の解析 |
| `internal/files/` | 安全なファイルシステムアクセスと監視 |
| `internal/render/` | HTML の生成 |
| `internal/server/` | HTTP サーバー |
| `internal/gitdiff/` | Git の変更と履歴 |
| `internal/discovery/` | 稼働中サーバーの検出 |
| `internal/update/` | 自己更新 |
| `web/src/` | TypeScript の UI と CSS（`internal/web/dist/` にビルド） |
| `testdata/` | 閲覧用のサンプル |

### コマンド

Go 1.27、Node.js 24、npm、Make を使います。devcontainer はポート 3000 と 5173 を転送します。

```sh
make setup                 # Go モジュールと npm 依存関係の導入
make dev DIR=./testdata    # Go API と Vite 開発サーバー（localhost:5173）を起動
make build VERSION=dev     # 現在の OS・CPU 向け実行ファイルをビルド
make run DIR=./testdata PORT=3000
make run DIR=./testdata HOST=0.0.0.0 PORT=3000  # LAN からのアクセスを許可
make test                  # Go と UI のテスト
make test-e2e              # Chromium のブラウザテスト
make screenshots           # README のスクリーンショットを再生成
make lint                  # go vet、TypeScript チェック、ESLint
make dist VERSION=v1.0.0   # 6 種類の実行ファイルと SHA-256 チェックサム
```

`make setup` の後は `make lint` を単独で実行できます。各 Make タスクは Web UI をビルドして実行ファイルに埋め込みます。開発中は Vite が API リクエストを Go へプロキシします。`make test-e2e` や `make screenshots` を初めて実行する前に、`cd web && npx playwright install --with-deps chromium` で Chromium と必要なライブラリを導入してください。

### CI とリリース

Pull Request では Linux・macOS・Windows で CI を実行し、Linux では Chromium のブラウザテストも実行します。通常のブランチ push では CI を実行しません。`v*` タグを push すると、GitHub Actions が各 OS のビルドを検証してからそのタグのリリースを作成します。リリース前に `make test`、`make lint`、`make test-e2e VERSION=<tag>`、`make dist VERSION=<tag>` をローカルで確認することもできます。

コミットメッセージは [Conventional Commits](https://www.conventionalcommits.org/ja/) に従います。
