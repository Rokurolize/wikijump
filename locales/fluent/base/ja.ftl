### Base localization / generic strings
### Messages should only go into this file if they are widely used,
### or are particularly important to localize.

## Terms

-service-name = Wikijump

## Special

# Shows whenever a message is still being loaded
message-loading = 読み込み中…

goto-home = ホームページに移動

goto-service = { -service-name }に移動

base-title = { $title } | { -service-name }

navigated-to = { $path }に移動しました

## Generic

about = 概要

about-info = プラットフォーム情報
    .backend = バックエンド
    .frontend = フロントエンド
    .package-name = パッケージ名
    .package-description = パッケージの説明
    .package-license = パッケージのライセンス
    .package-repository = パッケージのリポジトリ
    .package-version = パッケージのバージョン
    .rustc-version = Rustc のバージョン
    .cargo-version = Cargo のバージョン
    .built-at = ビルド日時
    .git-commit = Git コミット
    .ftml-commit = FTML コミット
    .blurb = Wikijump は、共同創作とワールドビルディングのための無料のオープンソースプラットフォームです。Wikidot の後継として、Wikijump チームと SCP コミュニティによって開発されています。
    .blog = Wikijump ブログ
    .node-version = Node のバージョン
    .pnpm-version = pnpm のバージョン
account = アカウント
alt-title = 代替タイトル
applications = 参加申請
avatar = アバター
breadcrumbs = パンくずリスト
cancel = キャンセル
change = 変更
children = 子ページ
clear = クリア
close = 閉じる
confirm = 確認
dashboard = ダッシュボード
delete = 削除
docs = ドキュメント
download = ダウンロード
edit = 編集
editor = エディター
error = エラー
files = ファイル
footer = ページフッター
general = 一般
header = ページヘッダー
help = ヘルプ
history = 履歴
inbox = 受信トレイ
invitations = 招待
layout = レイアウト
load = 読み込み
main-content = メインコンテンツ
messages = メッセージ
move = 移動
navigation = ナビゲーション
notifications = 通知
options = オプション
parents = 親ページ
preview = プレビュー
privacy = プライバシー
profile = プロフィール
publish = 公開
restore = 復元
reveal-sidebar = サイドバーを表示
save = 保存
security = セキュリティ
send = 送信
sent = 送信済み
settings = 設定
sidebar = サイドバー
tags = タグ
terminology = 用語
terms-conditions = 利用規約
title = タイトル
upload = アップロード
view = 表示
vote = 評価

search = 検索
  .placeholder = 検索…

## Generic Authentication

login = ログイン
  .toast = ログインしました。

logout = ログアウト
  .toast = ログアウトしました。

register = 登録
  .toast = 登録しました。
  .disabled-notice = このWikijumpではアカウントの新規作成を受け付けていません。アカウントは管理者が作成します。
  .legal-notice = アカウントを作成すると、
  .legal-terms = 利用規約
  .legal-conjunction = および
  .legal-privacy = プライバシーポリシー
  .legal-suffix = に同意したものとみなされます。

specifier = メールアドレスまたはユーザー名
  .placeholder = メールアドレスまたはユーザー名を入力…

mfa-code = MFA コード

username = ユーザー名
  .placeholder = ユーザー名を入力…
  .info = ユーザー名は後から変更できます。

email = メールアドレス
  .placeholder = メールアドレスを入力…
  .info = メールアドレスは公開されません。

password = パスワード
  .placeholder = パスワードを入力…

confirm-password = パスワードの再入力

forgot-password = パスワードを忘れた場合
  .question = パスワードをお忘れですか？

reset-password = パスワードを再設定

remember-me = ログイン状態を保持

create-account = アカウントを作成

field-required = この項目は必須です。

characters-left = { $count ->
  [1] 残り1文字
  *[other] 残り{ $count }文字
}

hold-to-show-password = 長押しでパスワードを表示

## Errors

error-404 =
  .generic = リクエストされたリソースが見つかりませんでした。
  .page = リクエストされたページが見つかりませんでした。
  .user = リクエストされたユーザーが見つかりませんでした。

error-form =
  .missing-fields = 必須項目をすべて入力してください。
  .password-mismatch = パスワードが一致しません。
  .password-too-short = パスワードは15文字以上で入力してください。
  .email-invalid = メールアドレスの形式が正しくありません。

error-api =
  .GENERIC = リクエストの処理中に問題が発生しました。
  .INTERNAL = 内部サーバーエラーが発生しました。後でもう一度お試しください。
  .NO_CONNECTION = インターネットに接続されていません。
  .BAD_SYNTAX = サーバーがリクエストを理解できませんでした。
  .FORBIDDEN = この操作を行う権限がありません。
  .NOT_FOUND = リクエストされたリソースが見つかりませんでした。
  .CONFLICT = リクエストされたリソースは別のリソースと競合しています。

  .ACCOUNT_ALREADY_VERIFIED = このアカウントはすでに確認済みです。
  .ACCOUNT_NO_EMAIL = このアカウントにはメールアドレスがありません。
  .ALREADY_LOGGED_IN = すでにログインしています。
  .FAILED_TO_UPDATE_PROFILE = プロフィールを更新できませんでした。
  .INVALID_AVATAR = アップロードされたファイルは有効な画像ではありません。
  .INVALID_EMAIL = メールアドレスが無効です。
  .INVALID_LANGUAGE_CODE = 言語コードが無効です。
  .INVALID_PASSWORD = パスワードが無効です。
  .INVALID_SESSION = セッションの有効期限が切れました。再度ログインしてください。
  .INVALID_SPECIFIER = メールアドレスまたはユーザー名が無効です。
  .INVALID_USERNAME = ユーザー名が無効です。
  .LOGIN_FAILED = ログインに失敗しました。認証情報を確認してください。
  .NOT_LOGGED_IN = ログインしていません。
  .UNKNOWN_EMAIL = そのメールアドレスのアカウントはありません。
  .UNKNOWN_USER = そのユーザー名のアカウントはありません。
  .WRONG_PASSWORD = パスワードが正しくありません。

error-418 = 私はティーポットです
### Editor UI (ED-9)

editor-toolbar-label = Wikiテキスト編集ツールバー
editor-toolbar-note = ソース編集：ボタンはWikidotのソースを挿入または囲みます。WYSIWYG出力は作成せず、テキストソースが常に優先されます。ショートカット：Ctrl/Cmd+B 太字、Ctrl/Cmd+I 斜体、Ctrl/Cmd+K リンク。他のショートカットはボタンのツールチップにあります。
editor-toolbar-heading1 = 見出しレベル 1
editor-toolbar-heading2 = 見出しレベル 2
editor-toolbar-heading3 = 見出しレベル 3
editor-toolbar-heading4 = 見出しレベル 4
editor-toolbar-heading5 = 見出しレベル 5
editor-toolbar-heading6 = 見出しレベル 6
editor-toolbar-bold = 太字
editor-toolbar-italic = 斜体
editor-toolbar-strike = 打ち消し線
editor-toolbar-teletype = 等幅文字
editor-toolbar-quote = 引用ブロック
editor-toolbar-bulleted-list = 箇条書きリスト
editor-toolbar-numbered-list = 番号付きリスト
editor-toolbar-horizontal-rule = 水平線
editor-toolbar-raw = 生テキスト
editor-toolbar-link = リンクを挿入
editor-toolbar-image = 画像を挿入
editor-toolbar-table = 表のひな形を挿入
editor-toolbar-code = コードブロック
editor-toolbar-footnote = 脚注
editor-toolbar-math = 数式ブロック
editor-toolbar-inline-math = 行内数式
editor-hint-notice = エディターのヒューリスティック警告：{ $count } 件 — レンダリングエラーではありません。
editor-link-prompt = リンク先
editor-image-prompt = 画像のURL
editor-preview-current = プレビューは最新です。
editor-preview-stale = プレビューは古くなっています。最新の編集のレンダリングを待っています。
editor-preview-loading = プレビューをレンダリング中…
editor-preview-paused = プレビューを一時停止中。変更はレンダリングされていません。
editor-preview-error = プレビューに失敗しました。編集と保存は引き続き利用できます。
editor-preview-timeout = プレビューのレンダリングがタイムアウトしました。
editor-preview-failed = プレビューに失敗しました。
editor-preview-failure = プレビューのレンダリングに失敗しました：{ $message }
editor-preview-pause = プレビューを一時停止
editor-preview-resume = プレビューを再開
editor-preview-retry = プレビューを再試行
editor-back-to-source = ソースに戻る
editor-properties-heading = ページのプロパティ
editor-properties-title = タイトル
editor-properties-alt-title = 別タイトル
editor-properties-layout = レイアウト
editor-properties-default-layout = デフォルト
editor-properties-layout-hint = レイアウトはページの「オプション」メニューから変更してください。
editor-properties-template = 初期テンプレート
editor-properties-no-template = テンプレートなし
editor-properties-tags = タグ
editor-properties-comments = リビジョンコメント
editor-properties-parent-heading = ページツリーの移動（親ページ）
editor-properties-parent-description = 親ページの変更はメタデータ編集ではなく、ページツリー構造の移動です。本文の保存後に適用され、独自のリビジョンを作成し、このページの編集権限が必要です。
editor-properties-parent-denied = このページをページツリー内で移動する権限がありません。親ページを変更する前に、サイト管理者に編集権限を依頼してください。
editor-properties-parent-load-error = 現在の親ページを読み込めませんでした。エディターを再読み込みして再試行してください。
editor-properties-parent = 親ページ
editor-properties-parent-hint-create = ページ作成時に適用されます。複数の親ページはスペースで区切ってください。
editor-properties-parent-hint-existing = 現在の親ページ：{ $parents }。フィールドを空にするとすべての親ページが削除されます。複数の親ページはスペースで区切ってください。
editor-properties-no-parents = なし
editor-properties-retry-move = ページツリーの移動を再試行
editor-section-heading = セクションを編集
editor-create-heading = 作成
editor-edit-heading = 編集
editor-checking-permission = 編集権限を確認中…
editor-acquiring-lock = ページの編集ロックを取得中…
editor-lock-conflict = このページは別のユーザーが編集中です。
editor-lock-superseded = 編集ロックが別のユーザーに取得されました。ロックを取り戻すまで保存は拒否されます。
editor-take-lock-back = ロックを取り戻す
editor-draft-sync-error = ページの下書きが同期されていません：{ $message }
editor-draft-check-error = ページの下書きを確認できませんでした。
editor-draft-sync-failure = ページの下書きを同期できませんでした。
editor-draft-discard-failure = ページの下書きを破棄できませんでした。
editor-check-properties = ページのプロパティを確認してください。
editor-save-content-and-parent = ページの本文を保存し、ページツリーの移動を適用しています…
editor-save-properties = ページのプロパティを保存しています…
editor-save-parent = 本文を保存しました。ページツリーの移動を適用しています…
editor-save-parent-apply = ページツリーの移動を適用しています…
editor-parent-move-failure = ページツリーの移動リクエストが失敗しました。親ページを確認して再度お試しください。
editor-save-parent-success = ページのプロパティとページツリーの移動を保存しました。
editor-lock-request-failure = 編集ロックのリクエストが失敗しました。
editor-draft-title = 保存された下書きがあります
editor-draft-description = このページの下書きがあります。リビジョンとしては公開されておらず、現在のページ本文はエディターに残っています。
editor-draft-title-label = 下書きのタイトル：
editor-draft-choice = 下書きをエディターに復元するか、破棄できます。選択するまで下書きは変更されません。
editor-draft-restore = 下書きを復元
editor-draft-discard = 下書きを破棄
editor-draft-restored = 下書きをエディターに復元しました。
editor-draft-discarded = 下書きを破棄しました。
editor-save-result = ページを保存しました。
editor-save-partial = 本文は保存されましたが、ページツリーの移動は適用されませんでした。
editor-lease-title-conflict = ページが編集中です
editor-lease-title-changed = ページが変更されました
editor-lease-title-taken = 編集ロックが他のユーザーに取得されました
editor-lease-conflict-description = このページは現在別のユーザーが編集中のようです。詳細は次のとおりです：
editor-lease-conflict-user = ユーザー { $user } — ロックモード：{ $mode } — 残り時間：{ $remaining }
editor-lease-conflict-choice = ロックの期限切れを待つか、強制的に編集してロックを引き継ぐことができます。後者の場合、他の編集者は保存できなくなります。
editor-lease-changed-description = 編集開始後にページが変更されたため、保存は拒否されました。入力内容は現在のバージョンとマージされていません。
editor-lease-changed-choice = 現在のページを表示する、現在の本文でエディターを再読み込みする（変更内容は失われます）、または退出前に入力内容をコピーできます。
editor-lease-taken-description = 別の編集者がページの編集ロックを取得したため、保存は拒否されました。ロックを取り戻すと現在のバージョンに対して編集セッションが再開されます。またはエディターを退出できます。
editor-lease-edit-anyway = 強制的に編集
editor-lease-cancel = キャンセル
editor-lease-view-page = 現在のページを表示
editor-lease-reload = エディターを再読み込み
editor-lease-copy-text = 入力内容をコピー
editor-lease-close = 閉じる
editor-lease-leave = エディターを退出
editor-lease-dialog-title = ページの編集ロック
