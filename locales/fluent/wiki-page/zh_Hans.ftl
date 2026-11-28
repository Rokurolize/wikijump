### 维基页面查看

wiki-page-category = 分类：{ $category }

wiki-page-module-new-page-name = 新页面名称
wiki-page-module-search-all-query = 搜索所有维基

wiki-page-revision = 页面版本：{ $revision }

wiki-page-last-edit = 最后编辑于: { $date } ({ $days ->
  [0] 今日
  [1] 昨日
  *[other] { $days } 日前
})

wiki-page-attributions = 署名信息
wiki-page-attribution-kind =
  .author = 作者
  .rewrite = 重写者
  .translator = 译者
  .maintainer = 维护者

wiki-page-source = 页面源代码

wiki-page-view-source = 查看源代码
wiki-page-action-append = 追加
wiki-page-action-edit-sections = 编辑章节
wiki-page-action-edit-meta = 编辑元标签
wiki-page-action-watchers = 监视者
wiki-page-watchers-unimported = 此导入页面的监视者列表不可用，因为其订阅信息未被导入。
wiki-page-action-backlinks = 反向链接
wiki-page-action-lock = 锁定页面
wiki-page-action-rename-move = 移动

wiki-page-revision-history = 页面修订历史

wiki-page-revision-filter =
  .show = 显示页面更改：
  .all = 全部
  .source = 源代码更改
  .title = 标题更改
  .move = 页面名称更改
  .tags = 标签更改
  .meta = 元数据更改
  .files = 文件更改
wiki-page-revision-perpage = 每页修订版本数：
wiki-page-revision-update-list = 更新列表
wiki-page-revision-compare-versions = 比较版本
wiki-page-revision-pager =
  .page = 页
  .of = /
  .previous = 上一页
  .next = 下一页

wiki-page-revision-diff = 比较修订版本
  .from = 起始版本
  .to = 目标版本
  .compare = 比较
  .swap = 交换
  .loading = 正在加载比较…
  .no-changes = 没有差异。
  .unavailable = 没有两个可供比较的页面修订版本。

wiki-page-revision-view-unavailable = 历史页面快照不可用

wiki-page-revision-banner =
  .title = 历史修订版本
  .page = 页面
  .close = 关闭

wiki-page-revision-number = 版本编号

wiki-page-revision-created-at = 编辑时间

wiki-page-revision-user = 编辑用户

wiki-page-revision-comments = 编辑摘要

wiki-page-revision-rollback = 回滚

wiki-page-revision-type = 类型
  .create = 创建
  .regular = 编辑
  .move = 移动
  .delete = 删除
  .rollback = 回滚
  .undelete = 恢复
  .undo = 撤销

### 维基页面评分

wiki-page-vote = 页面评分
  .description = 请为本页内容评分。
  .set = 进行评分
  .remove = 取消评分
  .list = 查看评分列表
  .score = 当前评分
  .like = 喜欢
  .dislike = 不喜欢
  .cancel = 取消我的评分
  .who-rated = 查看给本页评分的用户
  .user = 用户
  .toast-set = 评分成功。
  .toast-remove = 取消评分成功。

### 维基页面编辑

wiki-page-append-content = 要追加的维基文本

wiki-page-edit = 编辑页面
  .toast = 页面保存成功。

wiki-page-create = 创建新页面

wiki-page-move = 移动页面
  .new-slug = 新页面网址
  .toast = 页面移动成功。

wiki-page-layout = 页面布局
  .default = 默认布局
  .wikidot = Wikidot（旧）
  .wikijump = Wikijump
  .toast = 页面布局保存成功。

wiki-page-meta-tag-name = 元标签名称
wiki-page-meta-tag-content = 元标签内容

wiki-page-delete = 删除页面
  .toast = 页面删除成功。

wiki-page-restore = 恢复页面
  .select = 选择需恢复的页面
  .toast = 页面恢复成功。

wiki-page-deleted = 删除于 { $datetime }

### 维基页面附件

wiki-page-file-no-files = 本页没有上传任何文件。

wiki-page-file-upload =
  .select = 选择文件：
  .name = 文件名：
  .toast = 文件上传成功。

wiki-page-file-delete =
  .toast = 文件删除成功。
  .confirmation = 删除文件？
  .filename = 文件
  .page = 页面
  .confirm = 确认删除

wiki-page-file-move-destination-page = 新页面网址

wiki-page-file = 页面附件
  .name = 文件名
  .created-at = 创建日期
  .updated-at = 最后编辑日期
  .mime = 文件类型
  .size = 文件大小
  .page = 页面

wiki-page-file-list =
  .title = 文件
  .total-files = 文件总数：
  .total-size = 总大小：
  .header-name = 文件名
  .header-type = 文件类型
  .header-size = 大小
  .info = 信息
  .options = 选项
  .rename = 重命名
  .move = 移动
  .delete = 删除
  .history = 历史
  .upload = 从您的计算机上传文件
wiki-page-file-info =
  .title = 文件信息
  .name = 文件名：
  .url = 完整文件 URL：
  .size = 文件大小：
  .mime = MIME 类型：
  .content-type = 内容类型：
  .uploaded-by = 上传者：
  .upload-date = 上传日期：
  .unavailable = 不可用
  .close = 关闭

wiki-page-file-revision-type = 类型
  .create = 创建
  .regular = 编辑
  .move = 移动
  .delete = 删除
  .rollback = 回滚
  .undelete = 恢复
  .undo = 撤销

wiki-page-file-history = 文件历史

wiki-page-file-restore = 恢复
  .new-page = 新页面网址
  .new-name = 新文件名
  .toast = 文件恢复成功。

wiki-page-file-mirror-readonly =
  .title = PERMISSION ERROR
  .lead-in = 请注意：
  .message = 此导入页面上的文件为只读。
  .extra-message = 镜像页面显示来源文件清单。如需更新这些文件，请联系站点管理员通过 Wikidot 导入进行操作。

### 维基页面锁定

wiki-page-lock = 锁定页面
  .permission-only = 仅权限用户
  .author-or-permission-only = 仅权限用户或发布者
  .permission-only-text = 仅具有越过锁定权限的用户可以编辑。
  .author-or-permission-only-text = 仅具有越过锁定权限的用户以及页面发布者可以编辑。
  .reason = 锁定原因（可选）
  .expires-at = （可选）设定自动取消锁定的期限：
  .override = 覆盖现有锁定
  .history = 页面锁定历史
  .history-type = 类型
  .history-user = 锁定创建者
  .history-reason = 锁定原因
  .history-created = 创建时间
  .history-expires = 到期时间
  .history-status = 状态
  .history-active = 有效
  .history-expired = 已过期
  .history-removed = 已移除
  .history-overridden = 已覆盖
  .history-none = 本页没有锁定历史。
  .remove = 移除
  .toast = 页面锁定成功。
  .toast-remove = 页面锁定移除成功。
  .toast-override = 页面锁定覆盖成功。

### 维基页面父页面

wiki-page-parent = 父页面
  .toast = 父页面保存成功。

### 维基页面子页面

wiki-page-children = 子页面
  .no-children = 本页没有子页面。

### 蓝图页面

wiki-page-missing = 您访问的页面 //{ $slug }// 并不存在。

wiki-page-private = + 私有内容

    该网站的这个区域是私人的，您无权访问。如果您认为您的确需要访问该区域，请联系站点管理员。

wiki-page-banned = + 您已经被封禁

    您已经被本站封禁，而本站设定并不允许被封禁用户访问页面。

wiki-page-no-render = 内容停止显示。
