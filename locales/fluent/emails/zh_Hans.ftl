### 电子邮件

emails-subscribed = 您收到此封电子邮件的原因是您订阅了 { -service-name }。
emails-unsubscribe = 取消订阅
  .text = 如果您希望取消订阅，请点击下方的链接。
  .copy = 如果您无法点击 “{ $action }” 按钮，您可以复制下方的地址并将其黏贴至您的浏览器内：

emails-verify-email =
  .subject = 验证电子邮箱地址
  .greeting = 验证您的电子邮箱地址
  .intro = 请点击下方的按钮以验证您的电子邮箱地址。
  .action = 验证电子邮箱地址
  .outro = 如果您并未创建账号，则无需做出任何操作。

emails-reset-password =
  .subject = 密码重置请求
  .greeting = 重置您的密码
  .intro = 您收到此封电子邮件的原因是我们收到了您账号的密码重置请求。点击下方的按钮以重置您的密码。
  .action = 重置密码
  .expires = 此密码重置链接将于 { $count ->
    [1] 1 分钟后过期。
    *[other] { $count } 分钟后过期。
  }
  .outro = 若您并未请求密码重置，则无需做出任何操作。

emails-delete-account =
  .subject = 确认删除账号
  .greeting = 确认删除您的账号
  .intro = 请点击下方按钮确认删除您的账号。
  .action = 确认删除账号
  .outro = 如果您并未请求删除账号，则无需做出任何操作。

emails-reset-grant =
  .subject = 密码重置已批准
  .greeting = 密码重置已批准
  .intro = 您的密码重置请求已获批准。本邮件不包含链接，请在浏览器中继续完成操作。
  .outro = 若您并未请求密码重置，则无需做出任何操作。

emails-delete-grant =
  .subject = 账号删除已批准
  .greeting = 账号删除已批准
  .intro = 您的账号删除请求已获批准。本邮件不包含链接，请在浏览器中继续完成操作。
  .outro = 若您并未请求删除账号，则无需做出任何操作。

emails-invitation =
  .subject = 邀请您加入 { $site_name }
  .greeting = 您好，{ $recipient_name }！
  .intro = { $sender_name } 邀请您加入 { $site_name }。
  .action = 接受邀请
  .outro = 如果您并未收到此邀请，则无需理会本邮件。
