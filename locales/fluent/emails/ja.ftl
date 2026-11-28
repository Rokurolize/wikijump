### Emails

emails-subscribed = このメールは、{ -service-name }を購読しているため送信されています。
emails-unsubscribe = 購読解除
  .text = 購読を解除するには、以下のリンクをクリックしてください。
  .copy = 「{ $action }」ボタンをクリックできない場合は、次のURLをコピーしてブラウザに貼り付けてください：

emails-verify-email =
  .subject = メールアドレスの確認
  .greeting = メールアドレスを確認してください
  .intro = 以下のボタンをクリックして、メールアドレスを確認してください。
  .action = メールアドレスを確認
  .outro = アカウントを作成していない場合は、これ以上の操作は不要です。

emails-reset-password =
  .subject = パスワード再設定のリクエスト
  .greeting = パスワードの再設定
  .intro =
    アカウントのパスワード再設定がリクエストされたため、このメールを送信しています。
    以下のボタンをクリックして、パスワードを再設定してください。
  .action = パスワードを再設定
  .expires = このパスワード再設定リンクは{ $count ->
    [1] 1分後に期限切れになります。
    *[other] { $count }分後に期限切れになります。
  }
  .outro = パスワード再設定をリクエストしていない場合は、これ以上の操作は不要です。

emails-delete-account =
  .subject = アカウント削除の確認
  .greeting = アカウント削除を確認してください
  .intro = 以下のボタンをクリックして、アカウントを削除することを確認してください。
  .action = アカウントを削除
  .outro = アカウント削除をリクエストしていない場合は、これ以上の操作は不要です。

emails-reset-grant =
  .subject = パスワード再設定が承認されました
  .greeting = パスワード再設定が承認されました
  .intro = パスワード再設定のリクエストが承認されました。ブラウザで手続きを続行してください。このメールにリンクは含まれていません。
  .outro = パスワード再設定をリクエストしていない場合は、これ以上の操作は不要です。

emails-delete-grant =
  .subject = アカウント削除が承認されました
  .greeting = アカウント削除が承認されました
  .intro = アカウント削除のリクエストが承認されました。ブラウザで手続きを続行してください。このメールにリンクは含まれていません。
  .outro = アカウント削除をリクエストしていない場合は、これ以上の操作は不要です。

emails-invitation =
  .subject = { $site_name }への参加招待
  .greeting = こんにちは、{ $recipient_name }さん！
  .intro = { $sender_name }さんがあなたを{ $site_name }に招待しました。
  .action = 招待を受け入れる
  .outro = この招待に心当たりがない場合は、このメールを無視してください。
