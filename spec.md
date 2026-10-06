# Paste ビュー (`/?view=paste`) UX 改善仕様

## 背景

`/?view=paste` は Markdown を貼り付けて Rendered view で確認するための画面だが、実際には簡易メモ帳としても使われている。現状の課題は次の 2 点。

1. **テキスト段階で Markdown 構造が見えない**: 素の `<textarea>` で単色等幅表示のため、見出し・リスト・コードブロックの区切りが判別しづらい。構造を確認するには Rendered view に切り替える必要がある。
2. **入力欄が狭く視認性が悪い**: `article` 共通の `max-width: 46em` と `margin: 24px auto` がそのまま効いており、ワイド画面でも本文幅に制限される。さらに高さは `clamp(320px, 55vh, 700px)` 固定、文字サイズは 13px、ラベル・アクション行・通知行が縦に並ぶため、実際に書ける領域が小さい。

### 現状実装（参照）

- `web/src/main.ts` `showPaste()`: `#file-title` に見出しと `#paste-view-toggle`、`#content` に `.paste-editor`（label + `#paste-input` textarea + Clear + notice）と `.paste-preview` を配置。
- `web/src/style.css`: `.paste-editor textarea{min-height:clamp(320px,55vh,700px);font-size:13px;...}`、モバイルでは `min-height:45vh`。
- 保存は `sessionStorage`（キー `markport-pasted-markdown`）。上限は 1 MiB（クライアントと `internal/server/server.go` の両方）。
- レンダリングは `POST /api/render` → `render.PastedMarkdown`（相対リンク・画像は除去）。
- グローバルショートカットは `shortcuts.ts` で textarea 内では無効化済み。

## 目標 / 非目標

**目標**

- Text 状態のまま、見出し・強調・コード・リスト等が色と太さで判別できる。
- 画面幅・高さを有効に使い、長文メモでも快適に書ける。
- 既存の挙動（1 MiB 上限、sessionStorage 復元、Rendered view の安全なリンク処理、テーマ切替）を壊さない。

**非目標**

- WYSIWYG 化、記号を隠すライブプレビュー（Obsidian のような編集体験）。
- サーバー側へのメモ保存・複数メモ管理（markport は read-only ブラウザという前提を維持）。
- 新規の重量級エディタ依存（CodeMirror / Monaco 等）の導入。

---

## 1. テキスト段階の簡易 Markdown ハイライト

### 1.1 方式: textarea + 背面ハイライトレイヤー

透明文字の `<textarea>` の背面に、同一フォント・同一折り返し・同一 padding の `<pre aria-hidden="true">` を重ね、そこにハイライト済み HTML を描画する。

```
.paste-editor-surface (position: relative; grid で重ねる)
├─ pre.paste-highlight  aria-hidden="true"   ← 色付きテキスト（背面）
└─ textarea#paste-input                      ← 文字色 transparent、caret-color: var(--text)
```

採用理由:

- ネイティブ textarea のまま、IME 入力・Undo/Redo・スペルチェック・アクセシビリティ・既存 e2e（`getByLabel('Markdown Text').fill(...)`）がそのまま使える。
- 依存追加ゼロ。バンドルサイズへの影響が小さい。
- CodeMirror 6 は高機能だが、「簡易な認識」という要件に対して過剰。将来要件が増えた場合の移行先として記録しておく。

実装上の注意:

- textarea と pre の `font`, `line-height`, `padding`, `border-width`, `white-space: pre-wrap`, `overflow-wrap`, `tab-size`, `letter-spacing` を完全一致させる（CSS 変数で共通化）。
- スクロール同期: textarea の `scroll` イベントで pre の `scrollTop/scrollLeft` を追従。または textarea を自動伸長させて外側コンテナだけをスクロールさせる（後述 2.2 の「自動伸長」案ではこちらが単純）。
- 末尾が改行のとき pre の最終行が潰れないよう、描画時に末尾へ `\n` または ZWSP を追加する。
- ハイライトの HTML 生成では必ずテキストをエスケープし、`innerHTML` に入るのは自前で生成した `<span class>` のみとする（貼り付け内容由来の HTML を解釈しない）。
- 更新は `input` イベントごとに `requestAnimationFrame` でまとめる。1 MiB 近い入力でも固まらないよう、行単位のトークナイザを用い、閾値（例: 200 KB 超）ではハイライトを無効化してプレーン表示にフォールバックし、notice で知らせる。
- IME 変換中（`compositionstart`〜`compositionend`）は再描画を抑止し、確定後に反映する（変換中の下線表示との位置ずれを防ぐ）。

### 1.2 認識する構文（行ベースの簡易パーサ）

記号は**隠さない**（文字幅が変わるとキャレット位置がずれるため）。色・太さ・背景のみで表現する。太字は等幅フォントでも字幅が変わらないフォントのみ許容し、ずれる環境を避けるため `font-weight` 変更は見出しのみに限定するかどうかを実装時に検証する（ずれる場合は色のみで表現）。

| 種別 | 判定 | 表示 |
|---|---|---|
| 見出し `#`〜`######` | 行頭 `#{1,6}\s` | 行全体を `--accent` 系、記号部は muted |
| フェンスコードブロック | ```` ``` ```` / `~~~` で開閉（言語名付き可） | ブロック全体に `--code-bg` 背景、フェンス行は muted |
| インラインコード | `` `...` `` | `--syntax-string` 色 + 薄い背景 |
| 強調 | `**…**` `__…__` / `*…*` `_…_` / `~~…~~` | それぞれ色分け（`--syntax-keyword` 等）|
| リスト | 行頭 `-` `*` `+` / `1.` | マーカーを `--accent` |
| タスク | `- [ ]` / `- [x]` | チェックボックス部を強調、`[x]` 行は muted |
| 引用 | 行頭 `>` | 行全体を muted + 左ボーダー風の背景 |
| リンク / 画像 | `[text](url)` / `![alt](url)` / `<https://…>` | text を `--accent`、url 部を muted |
| 水平線 | `---` `***` `___` 単独行 | muted |
| テーブル | `|` を含む行 + 区切り行 `|---|` | `|` と区切り行を muted |
| 数式 | `$…$` / `$$…$$` | `--syntax-function` 色 |
| HTML コメント | `<!-- … -->` | `--syntax-comment` |

- フェンスコードブロック内では他の構文を解釈しない。
- 色はすべて既存のテーマトークン（`themes.css` の `--syntax-*`, `--accent`, `--text-muted`, `--code-bg`）を再利用し、5 テーマ × light/dark で自動追従させる。新規トークンが必要な場合は `--paste-*` として全テーマに定義し、`themeContrast.test.ts` の対象に加える。

### 1.3 実装配置

- 新規 `web/src/pasteHighlight.ts`: `highlightMarkdown(text: string): string`（エスケープ済み HTML を返す純粋関数）。DOM 非依存にして Vitest で単体テストする。
- `main.ts` の `showPaste()` はレイヤー構築とイベント配線のみ。肥大化を避けるため、エディタ部分を `web/src/pasteEditor.ts` に切り出すことも検討する。

### 1.4 オプション: 軽量な編集補助（Phase 2）

メモ帳用途で効果が大きいもののみ。いずれも textarea の `setRangeText` を使い、Undo 履歴を壊さない方法（`document.execCommand('insertText')` フォールバック含む）で実装する。

- **リスト継続**: リスト行末で Enter → 次行に同じマーカー（番号は +1、タスクは `- [ ] `）を挿入。空のリスト項目で Enter → マーカーを削除して終了。
- **Tab / Shift+Tab**: 選択行のインデント / アンインデント（2 スペース）。フォーカストラップを避けるため、`Esc` 直後の Tab は通常のフォーカス移動にする。
- IME 変換中（`event.isComposing`）は一切介入しない。

---

## 2. レイアウト・視認性の改善

### 2.1 幅

- `article[data-kind=paste]` に `max-width: none` を適用し、メインペイン幅いっぱいに広げる（image/html/pdf と同じ扱い）。
- ただし Text 状態は、行が長くなりすぎないよう textarea 内側に読みやすい上限（例: `max-width: 100ch` を中央寄せ）を設けるか、全幅にするかをトグルできるようにする。デフォルトは全幅。
- Rendered view は従来通り `46em` の読書幅を維持する（`.paste-preview` に `max-width: 46em; margin-inline: auto`）。

### 2.2 高さ

- textarea を固定 `min-height` ではなく、ビューポート残り高さいっぱいに広げる: `height: calc(100vh - 56px(header) - var(--titlebar-h) - 余白)`。
- 内容が長い場合は textarea 自身をスクロールさせる（`main` 側の二重スクロールを避ける）。`resize: vertical` は不要になるため削除。
- モバイル（≤700px）は `100dvh` を使い、ソフトウェアキーボード表示時に入力欄が隠れないようにする。

### 2.3 タイポグラフィ

- 文字サイズ 13px → 14〜15px、`line-height: 1.6`。
- 現在のフォントは `--mono`。メモ用途では日本語混在の可読性が重要なため、**等幅 / プロポーショナルの切替**を用意する（ハイライトは記号を隠さないためどちらでもキャレットずれは起きない）。デフォルトは等幅。
- `tab-size: 2`、`spellcheck="false"`（コード混在時のノイズ削減。切替可でもよい）。

### 2.4 画面構成の整理

縦方向の領域を本文に回すため、付帯 UI をタイトルバーへ集約する。

```
┌ #file-title ─────────────────────────────────────────────────┐
│ Pasted Markdown   1,234 文字 · 56 行 · 保存済み   [Text|Rendered] [⋯] │
└──────────────────────────────────────────────────────────────┘
┌ editor (全幅・残り高さいっぱい) ──────────────────────────────┐
│ # 見出し                                                      │
│ - リスト                                                       │
│ ```ts                                                          │
│ code                                                           │
│ ```                                                            │
└──────────────────────────────────────────────────────────────┘
 notice (エラー時のみ表示)
```

- 「Markdown Text」ラベルは視覚的に隠し（`.visually-hidden`）、アクセシブルネームとしては維持する（既存 e2e の `getByLabel('Markdown Text')` を壊さない）。
- 現状のトグルボタン（ラベルが状態によって入れ替わる）を、ファイル表示と同じ `.view-segment`（`Text` / `Rendered`、`aria-pressed`）に置き換え、現在の状態を一目で分かるようにする。
- Clear・Copy（全文コピー）・表示設定（等幅切替、幅切替）は `⋯` メニューまたはタイトルバー右側のアイコンボタンへ。Clear は誤操作防止のため、内容がある場合は確認する（または Undo 可能なトースト）。
- ステータス: 文字数・行数・保存状態（sessionStorage 書き込み成功 / 失敗 / 上限超過）をタイトルバーに小さく表示。1 MiB 上限に対する使用率が 80% を超えたら警告色。
- notice 行は常時スペースを確保しない（エラー時のみ表示）。

### 2.5 Split view（Phase 2）

- ワイド画面（≥1200px）で `Text | Split | Rendered` の 3 状態にし、Split では左 textarea・右プレビューを並べる。
- Split 中のプレビュー更新は入力停止後のデバウンス（例: 500ms）で `/api/render` を呼ぶ。既存の `pasteVersion` による競合破棄の仕組みをそのまま使う。
- スクロール同期は見出し単位の粗い同期に留める。

---

## 3. メモ帳用途のための補足

- **ショートカット**: `Ctrl/Cmd+Enter` で Text ↔ Rendered 切替、`Esc` で textarea からフォーカスを外す（既存のグローバルショートカットを使えるようにする）。`shortcutHelp.ts` に追記。
- **初期フォーカス**: paste ビューを開いたら textarea にフォーカスし、キャレットを前回位置（sessionStorage に保存）に復元。
- **永続化の選択肢（要判断）**: 現状 sessionStorage のためタブを閉じると消える。メモ用途では localStorage 保存のオプトイン（「このブラウザに保存」トグル）があると便利。ただし共有端末でのテキスト残存リスクがあるため、デフォルトは現状維持（sessionStorage）とする。
- **ダウンロード**: 「.md として保存」ボタン（`Blob` + `a[download]`）。read-only ブラウザの原則（サーバーへ書き込まない）に反しない。

---

## 4. 互換性・制約

- 1 MiB 上限、`/api/render` の仕様、`render.PastedMarkdown` の安全なリンク処理は変更しない（サーバー側変更なし）。
- `#paste-input` の id とアクセシブルネーム「Markdown Text」、`.paste-preview` クラスは維持（既存 e2e: `browser.e2e.ts` の paste 系、`themes.e2e.ts`）。
- テーマ切替時にハイライト色が即時追従すること（CSS 変数参照のみで実現し、再描画不要にする）。
- `prefers-reduced-motion` を尊重（アニメーションなし）。
- ハイライトレイヤーはスクリーンリーダーから隠す（`aria-hidden="true"`）。

## 5. テスト計画

**Vitest（`web/tests/pasteHighlight.test.ts` 新規）**

- 各構文のトークン化（見出し、強調、インラインコード、フェンス内で他構文を解釈しないこと、リスト・タスク、リンク、テーブル、数式）。
- HTML 特殊文字（`<script>`, `&`, `"`）が必ずエスケープされること。
- 出力のテキスト内容（タグ除去後）が入力と完全一致すること（キャレットずれ防止の不変条件）。
- 末尾改行・空入力・CRLF の扱い。
- 閾値超過時にハイライトが無効化されること。
- （Phase 2）リスト継続・インデントのテキスト変換関数。

**Playwright（`web/e2e/browser.e2e.ts` 追加）**

- 1440px 幅で textarea の幅が従来の 46em より広く、高さがビューポート残りを満たすこと。
- 入力後、`.paste-highlight` 内に見出し・コードのクラスが付くこと。textarea と highlight レイヤーの `scrollTop` が同期すること。
- Text / Rendered セグメントの `aria-pressed` が切り替わること、`Ctrl+Enter` で切り替わること。
- 5 テーマで paste 画面のスクリーンショット（`screenshots.e2e.ts`）を追加。
- モバイル幅（≤700px）で入力欄がキーボードに隠れず操作可能なこと。

`make test` / `make lint` / `make test-e2e` を通すこと。

## 6. 段階的リリース案

| Phase | 内容 |
|---|---|
| 1 | レイアウト改善（全幅・高さ・フォントサイズ・タイトルバー集約・セグメントトグル・ステータス表示） |
| 2 | 簡易 Markdown ハイライト（背面レイヤー方式） |
| 3 | 編集補助（リスト継続・Tab インデント）、ショートカット、.md ダウンロード |
| 4 | Split view、localStorage オプトイン保存 |

Phase 1 はリスクが低く単独で効果が大きいため先行する。Phase 2 はキャレットずれ・IME の検証コストが高いため、Phase 1 と別 PR にする。

## 7. 未決事項

- 等幅 / プロポーショナルのデフォルト。
- localStorage オプトイン保存を入れるか（共有端末リスクとのトレードオフ）。
- Clear の確認方式（確認ダイアログ vs Undo トースト）。
- ハイライト無効化の閾値（実測で決定）。
