### CodeMirror FTML Extension

cmftml-undocumented-block = Khối này hợp lệ, nhưng chưa được viết tài liệu.

## Linting

cmftml-lint =
  .warning-source = ftml({ $rule } = { $kind } at { $token }) [{ NUMBER($from, useGrouping: 0) }, { NUMBER($to, useGrouping: 0) }]

  .recursion-depth-exceeded = Đệ quy trong markup quá sâu.

  .end-of-input = Không thể xử lý quy tắc thuộc loại '{ $rule }' trước khi đến cuối tài liệu.

  .no-rules-matched = Chuỗi '{ $slice }' không khớp với bất kỳ quy tắc nào và sẽ được kết xuất như văn bản thuần.

  .rule-failed = Quy tắc '{ $rule }' không khớp tại đây và phải chuyển sang một quy tắc dự phòng khác.

  .not-start-of-line = Quy tắc '{ $rule }' không khớp tại đây vì nó chỉ có thể khớp ở đầu một dòng mới.

  .invalid-include = Include này không hợp lệ và sẽ không được kết xuất.

  .list-empty = Danh sách này không có nội dung bên trong.

  .list-contains-non-item = Danh sách này có phần tử con trực tiếp không phải là khối list-item.

  .list-item-outside-list = list-item này không nằm trong một danh sách.

  .list-depth-exceeded = Danh sách này lồng nhau quá sâu và không thể được kết xuất.

  .table-contains-non-row = Bảng này có phần tử con trực tiếp không phải là hàng của bảng.

  .table-row-contains-non-cell = Hàng bảng này có phần tử con trực tiếp không phải là ô.

  .table-row-outside-table = Hàng bảng này không nằm trong một bảng.

  .table-cell-outside-table = Ô bảng này không nằm trong một hàng bảng.

  .footnotes-nested = Chú thích cuối trang này không hợp lệ vì nó nằm trong một chú thích cuối trang khác.

  .blockquote-depth-exceeded = Khối trích dẫn này lồng nhau quá sâu và không thể được kết xuất.

  .no-such-block = Khối không xác định '{ $slice }'.

  .block-disallows-star = Khối '{ $slice }' không hỗ trợ cách gọi bằng dấu sao. (ký tự '*' ở đầu)

  .block-disallows-score = Khối '{ $slice }' không hỗ trợ cách gọi bằng dấu gạch dưới. (ký tự '_' ở đầu)

  .block-missing-name = Khối '{ $slice }' yêu cầu một tên/giá trị, nhưng không có tên/giá trị nào được chỉ định.

  .block-missing-close-brackets = Khối này thiếu dấu ngoặc đóng ']]'.

  .black-malformed-arguments = Khối '{ $slice }' có đối số không đúng định dạng.

  .block-missing-arguments = Khối '{ $slice }' thiếu một hoặc nhiều đối số bắt buộc.

  .block-expected-end = Khối thuộc loại '{ $rule }' phải kết thúc chậm nhất tại vị trí này.

  .block-end-mismatch = Khối thuộc loại '{ $rule }' phải kết thúc tại đây, không phải '{ $slice }'.

  .no-such-module = Module không xác định '{ $slice }'.

  .module-missing-name = Cần cung cấp tên module.

  .no-such-page = Trang '{ $slice }' không tồn tại.

  .invalid-url = URL '{ $slice }' không hợp lệ.

## Block Acceptance

cmftml-accepts =
  .star =
    Khối này chấp nhận tiền tố '*' (dấu sao).
    Hiệu ứng của tiền tố này tùy thuộc vào khối.

  .score =
    Khối này chấp nhận hậu tố '_' (dấu gạch dưới),
    hậu tố này sẽ loại bỏ các dòng mới ở đầu và cuối.

  .newlines =
    Khối này chấp nhận các dòng mới giữa nút bắt đầu và nút kết thúc.

  .html-attributes =
    Khối này chấp nhận các thuộc tính/đối số HTML chung.
    Các thuộc tính HTML chịu sự kiểm soát của danh sách cho phép, nhưng phần lớn vẫn có thể được sử dụng.

## Block Argument Types

cmftml-argument-none = NONE
  .info = Khối này không chấp nhận đối số nào.

cmftml-argument-value = VALUE
  .info = Khối này chấp nhận văn bản giữa phần bắt đầu và phần kết thúc của nút.

cmftml-argument-map = MAP
  .info = Khối này chấp nhận các đối số.

cmftml-argument-value-map = VALUE+MAP
  .info = Khối này chấp nhận văn bản, rồi sau một dấu cách chấp nhận các đối số.

## Block Body Types

cmftml-body-none = NONE
  .info = Khối này không có phần thân và không cần nút kết thúc.

cmftml-body-raw = RAW
  .info = Khối này chấp nhận phần thân, nhưng diễn giải phần thân đó như văn bản thô.

cmftml-body-elements = ELEMENTS
  .info = Khối này chấp nhận phần thân và có thể lồng thêm các phần tử trong đó.

cmftml-body-other = OTHER
  .info = Khối này có cú pháp đặc biệt không dễ phân loại.
