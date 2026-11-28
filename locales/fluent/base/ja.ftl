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
