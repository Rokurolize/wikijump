### Wiki Page View

wiki-page-category = 카테고리: { $category }

wiki-page-module-new-page-name = 새 페이지 이름
wiki-page-module-search-all-query = 모든 위키 검색

wiki-page-revision = 리비전: { $revision }

wiki-page-last-edit = 마지막 편집: { $date } ({ $days ->
  [0] 오늘
  [1] 어제
  *[other] { $days }일 전
})

wiki-page-attributions = 저작자 표시
wiki-page-attribution-kind =
  .author = 작성자
  .rewrite = 다시 쓴 사람
  .translator = 번역자
  .maintainer = 유지 관리자

wiki-page-source = 페이지 소스

wiki-page-view-source = 소스 보기

## Wiki page actions
wiki-page-action-append = 추가
wiki-page-action-edit-sections = 섹션 편집
wiki-page-action-edit-meta = 메타 태그 편집
wiki-page-action-watchers = 주시자
wiki-page-watchers-unimported = 이 가져온 페이지의 주시자 목록은 구독 정보를 가져오지 않았으므로 사용할 수 없습니다.
wiki-page-action-backlinks = 역링크
wiki-page-action-lock = 페이지 잠금
wiki-page-action-rename-move = 이동

wiki-page-revision-history = 페이지 리비전 기록

wiki-page-revision-filter =
  .show = 표시할 페이지 변경:
  .all = 전체
  .source = 소스 변경
  .title = 제목 변경
  .move = 페이지 이름 변경
  .tags = 태그 변경
  .meta = 메타데이터 변경
  .files = 파일 변경
wiki-page-revision-perpage = 페이지당 리비전 수:
wiki-page-revision-update-list = 목록 갱신
wiki-page-revision-compare-versions = 버전 비교
wiki-page-revision-pager =
  .page = 페이지
  .of = /
  .previous = 이전 페이지
  .next = 다음 페이지

wiki-page-revision-diff = 리비전 비교
  .from = 이전 리비전
  .to = 이후 리비전
  .compare = 비교
  .swap = 바꾸기
  .loading = 비교를 불러오는 중…
  .no-changes = 차이가 없습니다.
  .unavailable = 비교할 수 있는 페이지 리비전이 두 개 미만입니다

wiki-page-revision-view-unavailable = 과거 페이지 스냅샷을 사용할 수 없습니다

wiki-page-revision-banner =
  .title = 과거 리비전
  .page = 페이지
  .close = 닫기

wiki-page-revision-number = 리비전 번호

wiki-page-revision-created-at = 편집 시각

wiki-page-revision-user = 사용자

wiki-page-revision-comments = 코멘트

wiki-page-revision-rollback = 되돌리기

wiki-page-revision-type = 종류
  .create = 생성
  .regular = 편집
  .move = 이동
  .delete = 삭제
  .rollback = 되돌림
  .undelete = 복원
  .undo = 실행 취소

### Wiki Page Vote

wiki-page-vote = 페이지 평가
  .description = 이 페이지의 내용을 간단히 평가해보세요.
  .set = 평가하기
  .remove = 평가 취소
  .list = 평가 목록
  .score = 평가
  .like = 좋아요
  .dislike = 싫어요
  .cancel = 내 평가 취소
  .who-rated = 이 페이지를 평가한 사람 보기
  .user = 사용자
  .toast-set = 평가했습니다.
  .toast-remove = 평가를 취소했습니다.

### Wiki Page Edit

wiki-page-edit = 페이지 편집
  .toast = 페이지를 저장했습니다.

wiki-page-append-content = 추가할 위키 텍스트

wiki-page-create = 새 페이지 만들기

wiki-page-move = 페이지 이동
  .new-slug = 새 슬러그
  .toast = 페이지를 이동했습니다.

wiki-page-layout = 페이지 레이아웃
  .default = 기본 레이아웃
  .wikidot = Wikidot (레거시)
  .wikijump = Wikijump
  .toast = 페이지 레이아웃을 저장했습니다.

wiki-page-meta-tag-name = 메타 태그 이름
wiki-page-meta-tag-content = 메타 태그 내용

wiki-page-delete = 페이지 삭제
  .toast = 페이지를 삭제했습니다.

wiki-page-restore = 페이지 복원
  .select = 복원할 페이지 선택
  .toast = 페이지를 복원했습니다.

wiki-page-deleted = { $datetime }에 삭제됨

### Wiki Page Files

wiki-page-file-no-files = 이 페이지에는 파일이 없습니다.

wiki-page-file-upload =
  .select = 파일 선택:
  .name = 파일 이름:
  .toast = 파일을 업로드했습니다.

wiki-page-file-delete =
  .toast = 파일을 삭제했습니다.
  .confirmation = 이 파일을 삭제할까요?
  .filename = 파일
  .page = 페이지

  .confirm = 삭제 확인

wiki-page-file-move-destination-page = 대상 페이지

wiki-page-file = 페이지 파일
  .name = 파일 이름
  .created-at = 생성 시각
  .updated-at = 갱신 시각
  .mime = 파일 형식
  .size = 파일 크기
  .page = 페이지

wiki-page-file-list =
  .title = 파일
  .total-files = 전체 파일 수:
  .total-size = 전체 크기:
  .header-name = 파일 이름
  .header-type = 파일 형식
  .header-size = 크기
  .info = 정보
  .options = 옵션
  .rename = 이름 바꾸기
  .move = 이동
  .delete = 삭제
  .history = 기록
  .upload = 컴퓨터에서 파일 업로드
wiki-page-file-info =
  .title = 파일 정보
  .name = 파일 이름:
  .url = 전체 파일 URL:
  .size = 파일 크기:
  .mime = MIME 형식:
  .content-type = 콘텐츠 형식:
  .uploaded-by = 업로드한 사용자:
  .upload-date = 업로드 날짜:
  .unavailable = 알 수 없음
  .close = 닫기

wiki-page-file-history = 파일 기록

wiki-page-file-revision-type = 종류
  .create = 생성
  .regular = 편집
  .move = 이동
  .delete = 삭제
  .rollback = 되돌림
  .undelete = 복원
  .undo = 실행 취소

wiki-page-file-restore = 복원
  .new-page = 대상 페이지
  .new-name = 새 파일 이름
  .toast = 파일을 복원했습니다.

wiki-page-file-mirror-readonly =
  .title = PERMISSION ERROR
  .lead-in = 참고:
  .message = 이 가져온 페이지의 파일은 읽기 전용입니다.
  .extra-message = 미러 페이지에는 원본의 파일 목록이 표시됩니다. 파일을 갱신하려면 사이트 관리자에게 Wikidot 가져오기를 통해 처리해 달라고 요청하세요.

### Wiki page lock

wiki-page-lock = 페이지 잠금
  .permission-only = 권한 보유자만
  .author-or-permission-only = 권한 보유자/작성자만
  .permission-only-text = 잠금 우회 권한이 있는 회원만 편집할 수 있습니다.
  .author-or-permission-only-text = 권한이 있는 회원과 페이지 작성자만 편집할 수 있습니다.
  .reason = 이유 (선택 사항)
  .expires-at = (선택 사항) 이 잠금이 자동으로 해제될 날짜 설정:
  .override = 기존 잠금 덮어쓰기
  .history = 잠금 기록
  .history-type = 종류
  .history-user = 잠근 사용자
  .history-reason = 잠금 이유
  .history-created = 생성 시각
  .history-expires = 만료 시각
  .history-status = 상태
  .history-active = 활성
  .history-expired = 만료됨
  .history-removed = 해제됨
  .history-overridden = 대체됨
  .history-none = 이 페이지에는 잠금 기록이 없습니다.
  .remove = 해제
  .toast = 페이지를 잠갔습니다.
  .toast-remove = 페이지 잠금을 해제했습니다.
  .toast-override = 기존 페이지 잠금을 덮어썼습니다.

### Wiki page parents

wiki-page-parent = 부모 페이지
  .toast = 부모 페이지를 저장했습니다.

### Wiki Page Children

wiki-page-children = 자식 페이지
  .no-children = 이 페이지에는 자식 페이지가 없습니다.

### Blueprint page fallback strings

wiki-page-missing = 접근하려는 //{ $slug }// 페이지는 존재하지 않습니다.

wiki-page-private = + 비공개 콘텐츠

    이 사이트 영역은 비공개이며 접근 권한이 없습니다. 이 영역에 접근해야 한다고 생각하면 사이트 관리자에게 문의하세요.

wiki-page-banned = + 차단되었습니다

    현재 이 사이트에서 차단되어 있으며, 사이트 설정은 차단된 사용자의 페이지 열람을 허용하지 않습니다.

wiki-page-no-render = 콘텐츠가 표시되지 않습니다.
