### Base localization / generic strings
### Messages should only go into this file if they are widely used,
### or are particularly important to localize.

## Terms

-service-name = Wikijump

## Special

# Shows whenever a message is still being loaded
message-loading = Đang tải...

goto-home = Về trang chủ

goto-service = Đi tới { -service-name }

base-title = { $title } | { -service-name }

navigated-to = Đã chuyển đến { $path }

## Generic

about = Giới thiệu

about-info = Thông tin nền tảng
    .backend = Backend
    .frontend = Frontend
    .package-name = Tên gói
    .package-description = Mô tả gói
    .package-license = Giấy phép gói
    .package-repository = Kho mã nguồn của gói
    .package-version = Phiên bản gói
    .rustc-version = Phiên bản Rustc
    .cargo-version = Phiên bản Cargo
    .built-at = Thời điểm xây dựng
    .git-commit = Commit Git
    .ftml-commit = Commit FTML
    .blurb = Wikijump là một nền tảng mã nguồn mở miễn phí cho sáng tác hư cấu cộng tác và xây dựng thế giới: một giải pháp thay thế hiện đại cho Wikidot, do Đội ngũ Wikijump và cộng đồng SCP phát triển.
    .blog = Blog Wikijump
    .node-version = Phiên bản Node
    .pnpm-version = Phiên bản Pnpm
account = Tài khoản
alt-title = Tiêu đề thay thế
applications = Ứng dụng
avatar = Ảnh đại diện
breadcrumbs = Đường dẫn phân cấp
cancel = Hủy
change = Thay đổi
children = Trang con
clear = xóa
close = Đóng
confirm = Xác nhận
dashboard = Tổng quan
delete = Xóa
docs = Tài liệu
download = Tải xuống
edit = Chỉnh sửa
editor = Trình chỉnh sửa
error = Lỗi
files = Tệp
footer = Chân trang
general = Chung
header = Đầu trang
help = Trợ giúp
history = Lịch sử
inbox = Hộp thư
invitations = Lời mời
layout = Bố cục
load = Tải
main-content = Nội dung chính
messages = Tin nhắn
move = Di chuyển
navigation = Điều hướng
notifications = Thông báo
options = Tùy chọn
parents = Trang cha
preview = Xem trước
privacy = Quyền riêng tư
profile = Hồ sơ
publish = Xuất bản
restore = Khôi phục
reveal-sidebar = Hiển thị thanh cạnh
save = Lưu
security = Bảo mật
send = Gửi
sent = Đã gửi
settings = Cài đặt
sidebar = Thanh cạnh
tags = Thẻ
terminology = Thuật ngữ
terms-conditions = Điều khoản
title = Tiêu đề
upload = Tải lên
view = Xem
vote = Đánh giá

search = Tìm kiếm
  .placeholder = Tìm...

## Generic Authentication

login = Đăng nhập
  .toast = Bạn đã đăng nhập.

logout = Đăng xuất
  .toast = Bạn đã đăng xuất.

register = Đăng ký
  .toast = Bạn đã đăng ký thành công.
  .disabled-notice = Không thể tạo tài khoản trên hệ thống Wikijump này. Tài khoản do quản trị viên hệ thống tạo.
  .legal-notice = Khi tạo tài khoản, bạn đồng ý với{ " " }
  .legal-terms = Điều khoản dịch vụ
  .legal-conjunction = { " " }và{ " " }
  .legal-privacy = Chính sách bảo mật
  .legal-suffix = .

specifier = Email hoặc tên người dùng
  .placeholder = Nhập email hoặc tên người dùng...

mfa-code = Mã MFA

username = Tên người dùng
  .placeholder = Nhập tên người dùng...
  .info = Bạn sẽ có thể thay đổi thông tin này sau.

email = Email
  .placeholder = Nhập địa chỉ email...
  .info = Địa chỉ email của bạn là riêng tư.

password = Mật khẩu
  .placeholder = Nhập mật khẩu...

confirm-password = Xác nhận mật khẩu

forgot-password = Quên mật khẩu
  .question = Bạn đã quên mật khẩu?

reset-password = Đặt lại mật khẩu

remember-me = Ghi nhớ đăng nhập

create-account = Tạo tài khoản

field-required = Mục này là bắt buộc

characters-left = { $count ->
  [1] Còn lại 1 ký tự
  *[other] Còn lại { $count } ký tự
}

hold-to-show-password = Giữ để hiện mật khẩu

## Errors

error-404 =
  .generic = Không tìm thấy tài nguyên được yêu cầu.
  .page = Không tìm thấy trang được yêu cầu.
  .user = Không tìm thấy người dùng được yêu cầu.

error-form =
  .missing-fields = Vui lòng điền vào tất cả các mục bắt buộc.
  .password-mismatch = Mật khẩu không khớp.
  .password-too-short = Mật khẩu phải có ít nhất 15 ký tự.
  .email-invalid = Địa chỉ email không hợp lệ.

error-api =
  .GENERIC = Đã xảy ra lỗi với yêu cầu của bạn.
  .INTERNAL = Đã xảy ra lỗi máy chủ nội bộ. Vui lòng thử lại sau.
  .NO_CONNECTION = Bạn không được kết nối với Internet.
  .BAD_SYNTAX = Máy chủ không thể hiểu yêu cầu này.
  .FORBIDDEN = Bạn không có quyền thực hiện hành động này.
  .NOT_FOUND = Không tìm thấy tài nguyên được yêu cầu.
  .CONFLICT = Tài nguyên được yêu cầu đang xung đột với một tài nguyên khác.

  .ACCOUNT_ALREADY_VERIFIED = Tài khoản này đã được xác minh.
  .ACCOUNT_NO_EMAIL = Tài khoản này không có địa chỉ email.
  .ALREADY_LOGGED_IN = Bạn đã đăng nhập rồi.
  .FAILED_TO_UPDATE_PROFILE = Không thể cập nhật hồ sơ.
  .INVALID_AVATAR = Tệp đã tải lên không phải là một hình ảnh hợp lệ.
  .INVALID_EMAIL = Địa chỉ email không hợp lệ.
  .INVALID_LANGUAGE_CODE = Mã ngôn ngữ không hợp lệ.
  .INVALID_PASSWORD = Mật khẩu không hợp lệ.
  .INVALID_SESSION = Phiên đăng nhập của bạn đã hết hạn. Vui lòng đăng nhập lại.
  .INVALID_SPECIFIER = Email hoặc tên người dùng không hợp lệ.
  .INVALID_USERNAME = Tên người dùng không hợp lệ.
  .LOGIN_FAILED = Không thể đăng nhập. Vui lòng kiểm tra thông tin đăng nhập của bạn.
  .NOT_LOGGED_IN = Bạn chưa đăng nhập.
  .UNKNOWN_EMAIL = Không có tài khoản nào với địa chỉ email đó.
  .UNKNOWN_USER = Không có tài khoản nào với tên người dùng đó.
  .WRONG_PASSWORD = Mật khẩu không đúng.

error-418 = Tôi là một ấm trà
### Editor UI (ED-9)

editor-toolbar-label = Thanh công cụ soạn thảo mã nguồn Wikitext
editor-toolbar-note = Soạn thảo nguồn: các nút chèn hoặc bao quanh mã nguồn Wikidot; chúng không tạo đầu ra WYSIWYG và văn bản nguồn vẫn là dữ liệu chính. Phím tắt: Ctrl/Cmd+B in đậm, Ctrl/Cmd+I in nghiêng, Ctrl/Cmd+K chèn liên kết. Các phím tắt khác nằm trong chú giải của nút.
editor-toolbar-heading1 = Tiêu đề cấp 1
editor-toolbar-heading2 = Tiêu đề cấp 2
editor-toolbar-heading3 = Tiêu đề cấp 3
editor-toolbar-heading4 = Tiêu đề cấp 4
editor-toolbar-heading5 = Tiêu đề cấp 5
editor-toolbar-heading6 = Tiêu đề cấp 6
editor-toolbar-bold = In đậm
editor-toolbar-italic = In nghiêng
editor-toolbar-strike = Gạch ngang
editor-toolbar-teletype = Chữ đơn cách
editor-toolbar-quote = Khối trích dẫn
editor-toolbar-bulleted-list = Danh sách có dấu đầu dòng
editor-toolbar-numbered-list = Danh sách đánh số
editor-toolbar-horizontal-rule = Đường kẻ ngang
editor-toolbar-raw = Văn bản thô
editor-toolbar-link = Chèn liên kết
editor-toolbar-image = Chèn hình ảnh
editor-toolbar-table = Chèn khung bảng
editor-toolbar-code = Khối mã
editor-toolbar-footnote = Chú thích
editor-toolbar-math = Khối công thức
editor-toolbar-inline-math = Công thức nội dòng
editor-hint-notice = Cảnh báo heuristic của trình soạn thảo: { $count } — không phải lỗi kết xuất.
editor-link-prompt = Đích liên kết
editor-image-prompt = Nguồn hình ảnh
editor-preview-current = Bản xem trước đã cập nhật.
editor-preview-stale = Bản xem trước cũ. Đang chờ kết xuất thay đổi mới nhất.
editor-preview-loading = Đang kết xuất bản xem trước…
editor-preview-paused = Bản xem trước đã tạm dừng. Các thay đổi không được kết xuất.
editor-preview-error = Kết xuất bản xem trước thất bại. Bạn vẫn có thể soạn thảo và lưu.
editor-preview-timeout = Kết xuất bản xem trước quá thời gian chờ.
editor-preview-failed = Kết xuất bản xem trước thất bại.
editor-preview-failure = Kết xuất bản xem trước thất bại: { $message }
editor-preview-pause = Tạm dừng bản xem trước
editor-preview-resume = Tiếp tục bản xem trước
editor-preview-retry = Thử lại bản xem trước
editor-back-to-source = Về nguồn
editor-properties-heading = Thuộc tính trang
editor-properties-title = Tiêu đề
editor-properties-alt-title = Tiêu đề phụ
editor-properties-layout = Bố cục
editor-properties-default-layout = Mặc định
editor-properties-layout-hint = Đổi bố cục trong menu Tùy chọn của trang.
editor-properties-template = Mẫu ban đầu
editor-properties-no-template = Không có mẫu
editor-properties-tags = Thẻ
editor-properties-comments = Ghi chú phiên bản
editor-properties-parent-heading = Di chuyển cây trang (trang cha)
editor-properties-parent-description = Đổi trang cha là di chuyển cấu trúc cây trang, không phải chỉnh sửa siêu dữ liệu. Thao tác này áp dụng sau khi lưu nội dung, tạo phiên bản riêng và cần quyền chỉnh sửa trên trang này.
editor-properties-parent-denied = Bạn không có quyền di chuyển trang này trong cây trang. Hãy yêu cầu quản trị viên cấp quyền chỉnh sửa trước khi đổi trang cha.
editor-properties-parent-load-error = Không thể tải trang cha hiện tại. Hãy tải lại trình soạn thảo và thử lại.
editor-properties-parent = Trang cha
editor-properties-parent-hint-create = Áp dụng khi tạo trang. Tách nhiều trang cha bằng dấu cách.
editor-properties-parent-hint-existing = Trang cha hiện tại: { $parents }. Để trống ô này sẽ xóa tất cả trang cha. Tách nhiều trang cha bằng dấu cách.
editor-properties-no-parents = không có
editor-properties-retry-move = Thử lại di chuyển cây trang
editor-section-heading = Chỉnh sửa phần
editor-create-heading = Tạo
editor-edit-heading = Chỉnh sửa
editor-checking-permission = Đang kiểm tra quyền chỉnh sửa…
editor-acquiring-lock = Đang xin khóa chỉnh sửa trang…
editor-lock-conflict = Trang này đang được người khác chỉnh sửa.
editor-lock-superseded = Khóa chỉnh sửa đã bị người khác chiếm. Việc lưu sẽ bị từ chối cho đến khi bạn giành lại khóa.
editor-take-lock-back = Giành lại khóa
editor-draft-sync-error = Bản nháp của trang chưa được đồng bộ: { $message }
editor-draft-check-error = Không thể kiểm tra bản nháp của trang.
editor-draft-sync-failure = Không thể đồng bộ bản nháp của trang.
editor-draft-discard-failure = Không thể bỏ bản nháp của trang.
editor-check-properties = Hãy kiểm tra thuộc tính trang.
editor-save-content-and-parent = Đang lưu nội dung trang, sau đó áp dụng di chuyển cây trang…
editor-save-properties = Đang lưu thuộc tính trang…
editor-save-parent = Đã lưu nội dung. Đang áp dụng di chuyển cây trang…
editor-save-parent-apply = Đang áp dụng di chuyển cây trang…
editor-parent-move-failure = Yêu cầu di chuyển cây trang thất bại. Hãy kiểm tra trang cha và thử lại.
editor-save-parent-success = Đã lưu thuộc tính trang và di chuyển cây trang.
editor-lock-request-failure = Yêu cầu khóa chỉnh sửa thất bại.
editor-draft-title = Có bản nháp đã lưu
editor-draft-description = Trang này có một bản nháp. Bản nháp chưa được xuất bản thành phiên bản và văn bản hiện tại của trang vẫn nằm trong trình soạn thảo.
editor-draft-title-label = Tiêu đề bản nháp:
editor-draft-choice = Bạn có thể khôi phục bản nháp vào trình soạn thảo hoặc bỏ đi. Bản nháp sẽ không thay đổi cho đến khi bạn chọn.
editor-draft-restore = Khôi phục bản nháp
editor-draft-discard = Bỏ bản nháp
editor-draft-restored = Đã khôi phục bản nháp vào trình soạn thảo.
editor-draft-discarded = Đã bỏ bản nháp.
editor-save-result = Đã lưu trang.
editor-save-partial = Đã lưu nội dung nhưng di chuyển cây trang chưa được áp dụng.
editor-lease-title-conflict = Trang đang được chỉnh sửa
editor-lease-title-changed = Trang đã thay đổi
editor-lease-title-taken = Khóa chỉnh sửa đã bị chiếm
editor-lease-conflict-description = Có vẻ trang này hiện đang được người khác chỉnh sửa. Chi tiết như sau:
editor-lease-conflict-user = Người dùng { $user } — chế độ khóa: { $mode } — thời gian còn lại: { $remaining }
editor-lease-conflict-choice = Bạn có thể đợi khóa hết hạn hoặc ép chỉnh sửa và chiếm khóa. Khi đó người chỉnh sửa kia sẽ không thể lưu.
editor-lease-changed-description = Trang đã thay đổi sau khi bạn bắt đầu chỉnh sửa nên việc lưu bị từ chối. Văn bản của bạn chưa được hợp nhất với phiên bản hiện tại.
editor-lease-changed-choice = Bạn có thể xem trang hiện tại, tải lại trình soạn thảo với văn bản hiện tại (mất thay đổi của bạn) hoặc sao chép văn bản trước khi rời đi.
editor-lease-taken-description = Người chỉnh sửa khác đã chiếm khóa chỉnh sửa trang nên việc lưu bị từ chối. Giành lại khóa sẽ khởi động lại phiên soạn thảo theo phiên bản hiện tại, hoặc bạn có thể rời khỏi trình soạn thảo.
editor-lease-edit-anyway = Vẫn chỉnh sửa
editor-lease-cancel = Hủy
editor-lease-view-page = Xem trang hiện tại
editor-lease-reload = Tải lại trình soạn thảo
editor-lease-copy-text = Sao chép văn bản của tôi
editor-lease-close = Đóng
editor-lease-leave = Rời trình soạn thảo
editor-lease-dialog-title = Khóa chỉnh sửa trang
