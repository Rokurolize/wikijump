### 基础本地化 / 通用字符串
### 此文件应仅放置被广泛使用的或对本地化而言非常重要的信息。

## 术语

-service-name = Wikijump

## 特殊

# 仍在加载时显示的信息
message-loading = 加载中……

goto-home = 转到首页

goto-service = 转到 { -service-name }

base-title = { $title } | { -service-name }

navigated-to = 导航至 { $path }

## 通用

about = 关于

about-info = 平台信息
  .backend = 后端
  .frontend = 前端
  .package-name = 软件包名称
  .package-description = 软件包描述
  .package-license = 软件包许可证
  .package-repository = 软件包仓库
  .package-version = 软件包版本
  .rustc-version = Rustc 版本
  .cargo-version = Cargo 版本
  .built-at = 构建时间
  .git-commit = Git 提交
  .ftml-commit = FTML 提交
  .blurb = Wikijump 是一个用于协作小说创作与世界观构建的免费开源平台：它是 Wikidot 的现代替代品，由 Wikijump 团队和 SCP 社区共同开发。
  .blog = Wikijump 博客
  .node-version = Node 版本
  .pnpm-version = pnpm 版本
account = 账号
applications = 应用
alt-title = 替代标题
avatar = 头像
breadcrumbs = 面包屑
cancel = 取消
change = 修改
children = 子页面
clear = 清空
close = 关闭
confirm = 确认
dashboard = 仪表盘
delete = 删除
docs = 文档
download = 下载
edit = 编辑
editor = 编辑器
error = 错误
files = 附件
footer = 页脚
general = 通用
header = 页眉
help = 帮助
history = 历史
inbox = 收件箱
invitations = 邀请函
layout = 布局
load = 加载
main-content = 主要内容
messages = 信息
move = 移动
navigation = 导航
notifications = 通知
options = 选项
parents = 父页面
preview = 预览
privacy = 隐私
profile = 个人简介
publish = 发布
restore = 恢复
reveal-sidebar = 展开侧边栏
save = 保存
security = 安全
send = 发送
sent = 已发送
settings = 设置
sidebar = 侧边栏
tags = 标签
terminology = 术语
terms-conditions = 条款
title = 标题
upload = 上传
view = 查看
vote = 评分

search = 搜索
  .placeholder = 搜索……

## 通用认证

login = 登入
  .toast = 您已登入。

logout = 登出
  .toast = 您已登出。

register = 注册
  .toast = 您已注册。
  .disabled-notice = 此 Wikijump 实例未开放账号创建功能。账号由实例管理员创建。
  .legal-notice = 创建账号即表示您接受我们的
  .legal-terms = 服务条款
  .legal-conjunction = 和
  .legal-privacy = 隐私政策
  .legal-suffix = 。

specifier = 电子邮箱或用户名
  .placeholder = 输入电子邮箱或用户名……

mfa-code = MFA 验证码

username = 用户名
  .placeholder = 输入用户名……
  .info = 您可在稍后修改这项内容。

email = 电子邮箱
  .placeholder = 输入电子邮箱地址……
  .info = 您的电子邮箱地址不会被公开。

password = 密码
  .placeholder = 输入密码……

confirm-password = 确认密码

forgot-password = 忘记密码
  .question = 忘记密码？

reset-password = 重置密码

remember-me = 记住我

create-account = 创建账号

field-required = 此字段必须被填写

characters-left = { $count ->
  [1] 剩余 1 个字符
  *[other] 剩余 { $count } 个字符
}

hold-to-show-password = 按住以查看密码

## 错误

error-404 =
  .generic = 未找到所请求的来源。
  .page = 未找到所请求的页面。
  .user = 未找到所请求的用户。

error-form =
  .missing-fields = 请填入所有必填字段。
  .password-mismatch = 密码不一致。
  .password-too-short = 密码长度不得少于 15 个字符。
  .email-invalid = 电子邮箱地址格式不正确。

error-api =
  .GENERIC = 您的请求出现了错误。
  .INTERNAL = 发生了一次内部服务器错误。请稍后再试。
  .NO_CONNECTION = 您未连接至互联网。
  .BAD_SYNTAX = 请求无法被服务器理解。
  .FORBIDDEN = 您没有权限执行此操作。
  .NOT_FOUND = 未找到所请求的来源。
  .CONFLICT = 所请求的来源与另一来源冲突。

  .ACCOUNT_ALREADY_VERIFIED = 此账号已认证。
  .ACCOUNT_NO_EMAIL = 此账号无电子邮箱。
  .ALREADY_LOGGED_IN = 您已登入。
  .FAILED_TO_UPDATE_PROFILE = 个人简介更新失败。
  .INVALID_AVATAR = 上传的文件并非有效的图片。
  .INVALID_EMAIL = 电子邮箱地址不可用。
  .INVALID_LANGUAGE_CODE = 语言代码不可用。
  .INVALID_PASSWORD = 密码不可用。
  .INVALID_SESSION = 您的会话已过期。请重新登入。
  .INVALID_SPECIFIER = 电子邮箱或用户名不可用。
  .INVALID_USERNAME = 用户名不可用。
  .LOGIN_FAILED = 登入失败。请检查您的凭证。
  .NOT_LOGGED_IN = 您并未登入。
  .UNKNOWN_EMAIL = 该电子邮箱地址无对应的账号。
  .UNKNOWN_USER = 该用户名无对应的账号。
  .WRONG_PASSWORD = 密码不正确。

error-418 = 我是个茶壶
