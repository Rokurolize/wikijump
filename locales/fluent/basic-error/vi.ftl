### Basic Error HTML templates

basic-error-site-slug = <h1>Không có trang web { -service-name } nào tồn tại ở địa chỉ này</h1>
    <p>
      Trang web <a href="https://{ $slug }.{ $main_domain }/"><code>{ $slug }.{ $main_domain }</code></a> không tồn tại.
    </p>

    <p>
      Bạn có muốn tạo trang web này không? Nếu có, bạn có thể <a href="https://www.{ $main_domain }/new-site">tạo một trang web mới</a> với địa chỉ <code>{ $slug }.{ $main_domain }</code>.
    </p>

    <p>
      Quay lại <a href="https://{ $main_domain }/">{ -service-name }</a>.
    </p>

    .title = Không tìm thấy trang web - { -service-name }

basic-error-site-custom = <h1>Không có trang web { -service-name } nào tồn tại ở địa chỉ này</h1>
    <p>
      Không có trang web nào sử dụng tên miền tùy chỉnh <a href="https://{ $custom_domain }/"><code>{ $custom_domain }</code></a>.
    </p>

    <p>
      Quay lại <a href="https://{ $main_domain }/">{ -service-name }</a>.
    </p>

    .title = Không tìm thấy trang web - { -service-name }

basic-error-page-slug = <h1>Trang này không tồn tại</h1>
    <p>Trang được yêu cầu không tồn tại.</p>

    <p>
      Quay lại <a href="https://{ $domain }/">trang chủ của trang web</a>.
    </p>

    .title = Không tìm thấy trang - { $domain }

basic-error-page-fetch = <h1>Không thể lấy dữ liệu trang</h1>
    <p>
      Lỗi máy chủ: Không thể tải dữ liệu trang từ <a href="https://{ $domain }/{ $page_slug }"><code>{ $domain }/{ $page_slug }</code></a>.
    </p>

    <p>
      Quay lại <a href="https://{ $domain }/{ $page_slug }">trang</a> hoặc <a href="https://{ $domain }/">trang chủ của trang web</a>.
    </p>

    .title = Lỗi máy chủ - { $domain }

basic-error-file-name = <h1>Tệp này không tồn tại</h1>
    <p>
      Tệp <code>{ $filename }</code> trên trang <code>{ $domain }/{ $page_slug }</code> không tồn tại.
    </p>

    <p>
      Quay lại <a href="https://{ $domain }/{ $page_slug }">trang</a> hoặc <a href="https://{ $domain }/">trang chủ của trang web</a>.
    </p>

    .title = Không tìm thấy trang - { $domain }

basic-error-file-fetch = <h1>Không thể lấy dữ liệu tệp</h1>
    <p>
      Lỗi máy chủ: Không thể tải dữ liệu tệp <code>{ $filename }</code> trên trang <code>{ $domain }/{ $page_slug }</code>.
    </p>

    <p>
      Quay lại <a href="https://{ $domain }/{ $page_slug }">trang</a> hoặc <a href="https://{ $domain }/">trang chủ của trang web</a>.
    </p>

    .title = Lỗi máy chủ - { $domain }

basic-error-text-block = <h1>Khối văn bản lưu trữ không hợp lệ</h1>
    <p>
      { $reason ->
        [missing] Không tồn tại khối { $type ->
          [code] mã
          [html] HTML
          *[error] văn bản
        } với chỉ mục <code>{ $index }</code>.
        [invalid] Chỉ mục đã cho <code>{ $index }</code> không hợp lệ.
        [fetch] Không thể tải dữ liệu khối văn bản này.
        *[error] Lý do lỗi cơ bản không xác định: { $reason }
      }
    </p>

    <p>
      Quay lại <a href="https://{ $domain }/">trang chủ của trang web</a>.
    </p>

    .title = Lỗi khối văn bản - { $domain }

basic-error-file-root = <h1>Đường dẫn không hợp lệ</h1>
    <p>
      { -service-name } phục vụ dữ liệu do người dùng tạo từ <code>{ $files_domain }</code>, nhưng đây không phải là một URL hợp lệ.
    </p>

    <p>
      Quay lại <a href="https://{ $main_domain }/">{ -service-name }</a>.
    </p>

    .title = { -service-name }

basic-error-blob-fetch = <h1>Không thể lấy dữ liệu blob</h1>
    <p>
      Lỗi máy chủ: Không thể tải blob với mã băm S3 <code>{ $s3_hash }</code>.
    </p>

    .title = Lỗi máy chủ

basic-error-user-fetch = <h1>Không thể lấy dữ liệu người dùng</h1>
    <p>
      Lỗi máy chủ: Không thể tải dữ liệu của người dùng có ID <code>{ $user_id }</code>.
    </p>

    .title = Lỗi máy chủ

basic-error-user-avatar = <h1>Không thể lấy ảnh đại diện người dùng</h1>
    <p>
      Lỗi máy chủ: Không thể tải ảnh đại diện của người dùng có ID <code>{ $user_id }</code>.
    </p>

    .title = Lỗi máy chủ
