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
### Editor UI (ED-9)

editor-toolbar-label = Wiki 文本编辑工具栏
editor-toolbar-note = 源码编辑：按钮用于插入或包裹 Wikidot 源码，不会生成 WYSIWYG 输出，文本源码始终是权威来源。快捷键：Ctrl/Cmd+B 粗体、Ctrl/Cmd+I 斜体、Ctrl/Cmd+K 链接。其他快捷键见按钮提示。
editor-toolbar-heading1 = 一级标题
editor-toolbar-heading2 = 二级标题
editor-toolbar-heading3 = 三级标题
editor-toolbar-heading4 = 四级标题
editor-toolbar-heading5 = 五级标题
editor-toolbar-heading6 = 六级标题
editor-toolbar-bold = 粗体
editor-toolbar-italic = 斜体
editor-toolbar-strike = 删除线
editor-toolbar-teletype = 等宽字体
editor-toolbar-quote = 引用块
editor-toolbar-bulleted-list = 项目符号列表
editor-toolbar-numbered-list = 编号列表
editor-toolbar-horizontal-rule = 水平线
editor-toolbar-raw = 原始文本
editor-toolbar-link = 插入链接
editor-toolbar-image = 插入图片
editor-toolbar-table = 插入表格骨架
editor-toolbar-code = 代码块
editor-toolbar-footnote = 脚注
editor-toolbar-math = 公式块
editor-toolbar-inline-math = 行内公式
editor-hint-notice = 编辑器启发式警告：{ $count } 条——不是渲染错误。
editor-link-prompt = 链接目标
editor-image-prompt = 图片地址
editor-preview-current = 预览已是最新。
editor-preview-stale = 预览已过期，正在等待最新编辑内容渲染。
editor-preview-loading = 正在渲染预览…
editor-preview-paused = 预览已暂停，更改不会被渲染。
editor-preview-error = 预览渲染失败，仍可继续编辑和保存。
editor-preview-timeout = 预览渲染超时。
editor-preview-failed = 预览渲染失败。
editor-preview-failure = 预览渲染失败：{ $message }
editor-preview-pause = 暂停预览
editor-preview-resume = 继续预览
editor-preview-retry = 重试预览
editor-back-to-source = 返回源码
editor-properties-heading = 页面属性
editor-properties-title = 标题
editor-properties-alt-title = 备用标题
editor-properties-layout = 布局
editor-properties-default-layout = 默认
editor-properties-layout-hint = 请在页面的“选项”菜单中更改布局。
editor-properties-template = 初始模板
editor-properties-no-template = 无模板
editor-properties-tags = 标签
editor-properties-comments = 版本说明
editor-properties-parent-heading = 页面树移动（父页面）
editor-properties-parent-description = 更改父页面属于页面树结构移动，不是元数据编辑。它会在内容保存后应用，创建独立版本，并且需要对本页面拥有编辑权限。
editor-properties-parent-denied = 你没有权限在页面树中移动此页面。更改父页面前，请向网站管理员申请编辑权限。
editor-properties-parent-load-error = 无法加载当前父页面。请重新加载编辑器后重试。
editor-properties-parent = 父页面
editor-properties-parent-hint-create = 创建页面时应用。多个父页面请用空格分隔。
editor-properties-parent-hint-existing = 当前父页面：{ $parents }。留空将移除所有父页面。多个父页面请用空格分隔。
editor-properties-no-parents = 无
editor-properties-retry-move = 重试页面树移动
editor-section-heading = 编辑章节
editor-create-heading = 创建
editor-edit-heading = 编辑
editor-checking-permission = 正在检查编辑权限…
editor-acquiring-lock = 正在获取页面编辑锁…
editor-lock-conflict = 此页面正由其他用户编辑。
editor-lock-superseded = 编辑锁已被其他用户取得。取回锁之前保存将被拒绝。
editor-take-lock-back = 取回编辑锁
editor-draft-sync-error = 页面草稿未同步：{ $message }
editor-draft-check-error = 无法检查页面草稿。
editor-draft-sync-failure = 无法同步页面草稿。
editor-draft-discard-failure = 无法丢弃页面草稿。
editor-check-properties = 请检查页面属性。
editor-save-content-and-parent = 正在保存页面内容，随后应用页面树移动…
editor-save-properties = 正在保存页面属性…
editor-save-parent = 内容已保存。正在应用页面树移动…
editor-save-parent-apply = 正在应用页面树移动…
editor-parent-move-failure = 页面树移动请求失败。请检查父页面后重试。
editor-save-parent-success = 页面属性和页面树移动已保存。
editor-lock-request-failure = 编辑锁请求失败。
editor-draft-title = 存在已保存的草稿
editor-draft-description = 此页面存在草稿，尚未发布为版本，当前页面文本仍保留在编辑器中。
editor-draft-title-label = 草稿标题：
editor-draft-choice = 你可以将草稿恢复到编辑器或丢弃它。在做出选择之前，草稿不会改变。
editor-draft-restore = 恢复草稿
editor-draft-discard = 丢弃草稿
editor-draft-restored = 草稿已恢复到编辑器。
editor-draft-discarded = 草稿已丢弃。
editor-save-result = 页面已保存。
editor-save-partial = 内容已保存，但页面树移动未应用。
editor-lease-title-conflict = 页面正在被编辑
editor-lease-title-changed = 页面已更改
editor-lease-title-taken = 编辑锁已被他人取得
editor-lease-conflict-description = 此页面似乎正由其他用户编辑，详情如下：
editor-lease-conflict-user = 用户 { $user } — 锁定模式：{ $mode } — 剩余时间：{ $remaining }
editor-lease-conflict-choice = 你可以等待锁过期，或强制编辑并接管锁。接管后另一位编辑者将无法保存。
editor-lease-changed-description = 页面在你开始编辑后发生了更改，因此保存被拒绝。你的文本尚未与当前版本合并。
editor-lease-changed-choice = 你可以查看当前页面、用当前文本重新加载编辑器（会丢失你的更改），或在离开前复制你的文本。
editor-lease-taken-description = 其他编辑者取得了页面编辑锁，因此保存被拒绝。取回锁会以当前版本重新开始编辑会话，也可以离开编辑器。
editor-lease-edit-anyway = 仍然编辑
editor-lease-cancel = 取消
editor-lease-view-page = 查看当前页面
editor-lease-reload = 重新加载编辑器
editor-lease-copy-text = 复制我的文本
editor-lease-close = 关闭
editor-lease-leave = 离开编辑器
editor-lease-dialog-title = 页面编辑锁
