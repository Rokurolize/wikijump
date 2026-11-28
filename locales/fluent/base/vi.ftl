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
