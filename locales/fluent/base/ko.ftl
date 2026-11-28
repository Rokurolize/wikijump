### Base localization / generic strings
### Messages should only go into this file if they are widely used,
### or are particularly important to localize.

## Terms

-service-name = Wikijump

## Special

# Shows whenever a message is still being loaded
message-loading = 불러오는 중...

goto-home = 홈페이지로 가기

goto-service = { -service-name }(으)로 가기

base-title = { $title } | { -service-name }

navigated-to = { $path }(으)로 이동함

## Generic

about = 정보

about-info = 플랫폼 정보
    .backend = 백엔드
    .frontend = 프런트엔드
    .package-name = 패키지 이름
    .package-description = 패키지 설명
    .package-license = 패키지 라이선스
    .package-repository = 패키지 저장소
    .package-version = 패키지 버전
    .rustc-version = Rustc 버전
    .cargo-version = Cargo 버전
    .built-at = 빌드 시각
    .git-commit = Git 커밋
    .ftml-commit = FTML 커밋
    .blurb = Wikijump는 협업 픽션과 세계관 구축을 위한 자유 오픈소스 플랫폼으로, Wikijump 팀과 SCP 커뮤니티가 개발하는 Wikidot의 현대적 대체재입니다.
    .blog = Wikijump 블로그
    .node-version = Node 버전
    .pnpm-version = Pnpm 버전
account = 계정
alt-title = 대체 제목
applications = 애플리케이션
avatar = 아바타
breadcrumbs = 이동 경로
cancel = 취소
change = 바꾸기
children = 자식 페이지
clear = 지우기
close = 닫기
confirm = 확인
dashboard = 대시보드
delete = 삭제
docs = 문서
download = 다운로드
edit = 편집
editor = 편집기
error = 오류
files = 파일
footer = 페이지 푸터
general = 일반
header = 페이지 헤더
help = 도움말
history = 기록
inbox = 사서함
invitations = 초대
layout = 레이아웃
load = 불러오기
main-content = 주 콘텐츠
messages = 메시지
move = 이동
navigation = 탐색
notifications = 알림
options = 옵션
parents = 부모 페이지
preview = 미리보기
privacy = 개인 정보
profile = 프로필
publish = 게시
restore = 복원
reveal-sidebar = 사이드바 보이기
save = 저장
security = 보안
send = 보내기
sent = 보냄
settings = 설정
sidebar = 사이드바
tags = 태그
terminology = 용어
terms-conditions = 이용약관
title = 제목
upload = 업로드
view = 보기
vote = 평가

search = 검색
  .placeholder = 검색...

## Generic Authentication

login = 로그인
  .toast = 로그인되었습니다.

logout = 로그아웃
  .toast = 로그아웃되었습니다.

register = 가입하기
  .toast = 가입되었습니다.
  .disabled-notice = 이 Wikijump 인스턴스에서는 계정을 만들 수 없습니다. 계정은 인스턴스 관리자가 생성합니다.
  .legal-notice = 계정을 만들면{ " " }
  .legal-terms = 이용약관
  .legal-conjunction = { " " }및{ " " }
  .legal-privacy = 개인정보 처리방침
  .legal-suffix = 에 동의하는 것으로 간주됩니다.

specifier = 이메일 또는 사용자명
  .placeholder = 이메일 또는 사용자명을 입력하세요.

mfa-code = MFA 코드

username = 사용자명
  .placeholder = 사용자명을 입력하세요.
  .info = 나중에 바꿀 수 있습니다.

email = 이메일
  .placeholder = 이메일 주소를 입력하세요.
  .info = 이메일 주소는 공개되지 않습니다.

password = 비밀번호
  .placeholder = 비밀번호를 입력하세요.

confirm-password = 비밀번호 확인

forgot-password = 비밀번호를 잊음
  .question = 비밀번호를 잊으셨나요?

reset-password = 비밀번호 재설정하기

remember-me = 로그인 상태 유지하기

create-account = 계정 만들기

field-required = 필수 입력란입니다.

characters-left = { $count ->
  [1] 1자 남음
  *[other] { $count }자 남음
}

hold-to-show-password = 비밀번호를 보려면 길게 누르기

## Errors

error-404 =
  .generic = 요청한 리소스를 찾을 수 없습니다.
  .page = 요청한 페이지를 찾을 수 없습니다.
  .user = 요청한 사용자를 찾을 수 없습니다.

error-form =
  .missing-fields = 필수 입력란을 모두 채워주세요.
  .password-mismatch = 비밀번호가 같지 않습니다.
  .password-too-short = 비밀번호는 15자 이상이어야 합니다.
  .email-invalid = 이메일 주소가 올바르지 않습니다.

error-api =
  .GENERIC = 요청이 잘못되었습니다.
  .INTERNAL = 내부 서버 오류가 발생했습니다. 나중에 다시 시도해주세요.
  .NO_CONNECTION = 인터넷에 연결되지 않았습니다.
  .BAD_SYNTAX = 서버가 요청을 처리할 수 없습니다.
  .FORBIDDEN = 이 동작을 수행할 권한이 없습니다.
  .NOT_FOUND = 요청한 리소스를 찾을 수 없습니다.
  .CONFLICT = 요청한 리소스가 다른 리소스와 충돌합니다.

  .ACCOUNT_ALREADY_VERIFIED = 이 계정은 이미 인증되었습니다.
  .ACCOUNT_NO_EMAIL = 이 계정에는 등록된 이메일 주소가 없습니다.
  .ALREADY_LOGGED_IN = 이미 로그인되었습니다.
  .FAILED_TO_UPDATE_PROFILE = 프로필을 갱신할 수 없습니다.
  .INVALID_AVATAR = 업로드된 파일은 올바른 이미지가 아닙니다.
  .INVALID_EMAIL = 이메일 주소가 올바르지 않습니다.
  .INVALID_LANGUAGE_CODE = 언어 코드가 올바르지 않습니다.
  .INVALID_PASSWORD = 비밀번호가 올바르지 않습니다.
  .INVALID_SESSION = 세션이 만료되었습니다. 다시 로그인해주세요.
  .INVALID_SPECIFIER = 이메일 또는 사용자명이 올바르지 않습니다.
  .INVALID_USERNAME = 사용자명이 올바르지 않습니다.
  .LOGIN_FAILED = 로그인할 수 없습니다. 자격 증명을 확인해주세요.
  .NOT_LOGGED_IN = 로그인되지 않았습니다.
  .UNKNOWN_EMAIL = 해당 이메일 주소가 등록된 계정이 없습니다.
  .UNKNOWN_USER = 해당 사용자명을 가진 계정이 없습니다.
  .WRONG_PASSWORD = 비밀번호를 잘못 입력했습니다.

error-418 = 저는 찻주전자입니다.
### Editor UI (ED-9)

editor-toolbar-label = Wikitext 소스 편집 도구 모음
editor-toolbar-note = 소스 편집: 버튼은 Wikidot 소스를 삽입하거나 감쌉니다. WYSIWYG 출력을 만들지 않으며 텍스트 소스가 항상 기준입니다. 단축키: Ctrl/Cmd+B 굵게, Ctrl/Cmd+I 기울임, Ctrl/Cmd+K 링크. 다른 단축키는 버튼 도구 설명에 있습니다.
editor-toolbar-heading1 = 제목 수준 1
editor-toolbar-heading2 = 제목 수준 2
editor-toolbar-heading3 = 제목 수준 3
editor-toolbar-heading4 = 제목 수준 4
editor-toolbar-heading5 = 제목 수준 5
editor-toolbar-heading6 = 제목 수준 6
editor-toolbar-bold = 굵게
editor-toolbar-italic = 기울임
editor-toolbar-strike = 취소선
editor-toolbar-teletype = 고정폭 글씨
editor-toolbar-quote = 인용 블록
editor-toolbar-bulleted-list = 글머리 기호 목록
editor-toolbar-numbered-list = 번호 매기기 목록
editor-toolbar-horizontal-rule = 수평선
editor-toolbar-raw = 원본 텍스트
editor-toolbar-link = 링크 삽입
editor-toolbar-image = 이미지 삽입
editor-toolbar-table = 표 틀 삽입
editor-toolbar-code = 코드 블록
editor-toolbar-footnote = 각주
editor-toolbar-math = 수식 블록
editor-toolbar-inline-math = 본문 수식
editor-hint-notice = 편집기 휴리스틱 경고: { $count }개 — 렌더링 오류가 아닙니다.
editor-link-prompt = 링크 대상
editor-image-prompt = 이미지 주소
editor-preview-current = 미리보기가 최신 상태입니다.
editor-preview-stale = 미리보기가 오래되었습니다. 최신 편집 내용의 렌더링을 기다리는 중입니다.
editor-preview-loading = 미리보기를 렌더링하는 중…
editor-preview-paused = 미리보기가 일시정지되었습니다. 변경 내용이 렌더링되지 않습니다.
editor-preview-error = 미리보기에 실패했습니다. 편집과 저장은 계속 사용할 수 있습니다.
editor-preview-timeout = 미리보기 렌더링이 시간 초과되었습니다.
editor-preview-failed = 미리보기에 실패했습니다.
editor-preview-failure = 미리보기 렌더링 실패: { $message }
editor-preview-pause = 미리보기 일시정지
editor-preview-resume = 미리보기 다시 시작
editor-preview-retry = 미리보기 다시 시도
editor-back-to-source = 소스로 돌아가기
editor-properties-heading = 페이지 속성
editor-properties-title = 제목
editor-properties-alt-title = 대체 제목
editor-properties-layout = 레이아웃
editor-properties-default-layout = 기본값
editor-properties-layout-hint = 레이아웃은 페이지의 옵션 메뉴에서 변경하세요.
editor-properties-template = 초기 템플릿
editor-properties-no-template = 템플릿 없음
editor-properties-tags = 태그
editor-properties-comments = 리비전 설명
editor-properties-parent-heading = 페이지 트리 이동 (부모)
editor-properties-parent-description = 부모를 변경하는 것은 메타데이터 편집이 아니라 페이지 트리 구조 이동입니다. 본문 저장 후 적용되며 자체 리비전을 만들고 이 페이지의 편집 권한이 필요합니다.
editor-properties-parent-denied = 이 페이지를 페이지 트리에서 이동할 권한이 없습니다. 부모를 변경하기 전에 사이트 관리자에게 편집 권한을 요청하세요.
editor-properties-parent-load-error = 현재 부모를 불러오지 못했습니다. 편집기를 다시 불러오고 다시 시도하세요.
editor-properties-parent = 부모 페이지
editor-properties-parent-hint-create = 페이지를 만들 때 적용됩니다. 여러 부모는 공백으로 구분하세요.
editor-properties-parent-hint-existing = 현재 부모: { $parents }. 필드를 비우면 모든 부모가 제거됩니다. 여러 부모는 공백으로 구분하세요.
editor-properties-no-parents = 없음
editor-properties-retry-move = 페이지 트리 이동 다시 시도
editor-section-heading = 섹션 편집
editor-create-heading = 만들기
editor-edit-heading = 편집
editor-checking-permission = 편집 권한 확인 중…
editor-acquiring-lock = 페이지 편집 잠금을 가져오는 중…
editor-lock-conflict = 다른 사용자가 이 페이지를 편집하고 있습니다.
editor-lock-superseded = 다른 사용자가 편집 잠금을 가져갔습니다. 잠금을 되찾을 때까지 저장이 거부됩니다.
editor-take-lock-back = 잠금 되찾기
editor-draft-sync-error = 페이지 초안이 동기화되지 않았습니다: { $message }
editor-draft-check-error = 페이지 초안을 확인할 수 없습니다.
editor-draft-sync-failure = 페이지 초안을 동기화할 수 없습니다.
editor-draft-discard-failure = 페이지 초안을 버릴 수 없습니다.
editor-check-properties = 페이지 속성을 확인하세요.
editor-save-content-and-parent = 페이지 본문을 저장한 뒤 페이지 트리 이동을 적용하는 중…
editor-save-properties = 페이지 속성을 저장하는 중…
editor-save-parent = 본문을 저장했습니다. 페이지 트리 이동을 적용하는 중…
editor-save-parent-apply = 페이지 트리 이동을 적용하는 중…
editor-parent-move-failure = 페이지 트리 이동 요청이 실패했습니다. 부모 페이지를 확인하고 다시 시도하세요.
editor-save-parent-success = 페이지 속성과 페이지 트리 이동을 저장했습니다.
editor-lock-request-failure = 편집 잠금 요청이 실패했습니다.
editor-draft-title = 저장된 초안이 있습니다
editor-draft-description = 이 페이지의 초안이 있습니다. 아직 리비전으로 게시되지 않았으며 현재 페이지 본문은 편집기에 남아 있습니다.
editor-draft-title-label = 초안 제목:
editor-draft-choice = 초안을 편집기로 복원하거나 버릴 수 있습니다. 선택할 때까지 초안은 변경되지 않습니다.
editor-draft-restore = 초안 복원
editor-draft-discard = 초안 버리기
editor-draft-restored = 초안을 편집기에 복원했습니다.
editor-draft-discarded = 초안을 버렸습니다.
editor-save-result = 페이지를 저장했습니다.
editor-save-partial = 본문은 저장되었지만 페이지 트리 이동은 적용되지 않았습니다.
editor-lease-title-conflict = 페이지가 편집 중입니다
editor-lease-title-changed = 페이지가 변경되었습니다
editor-lease-title-taken = 편집 잠금을 다른 사용자에게 넘어갔습니다
editor-lease-conflict-description = 다른 사용자가 현재 이 페이지를 편집하고 있는 것 같습니다. 자세한 내용은 다음과 같습니다:
editor-lease-conflict-user = 사용자 { $user } — 잠금 모드: { $mode } — 남은 시간: { $remaining }
editor-lease-conflict-choice = 잠금이 만료될 때까지 기다리거나 강제로 편집하여 잠금을 넘겨받을 수 있습니다. 그러면 다른 편집자는 저장할 수 없습니다.
editor-lease-changed-description = 편집을 시작한 후 페이지가 변경되어 저장이 거부되었습니다. 입력한 내용은 현재 버전과 병합되지 않았습니다.
editor-lease-changed-choice = 현재 페이지를 보거나 현재 본문으로 편집기를 다시 불러오거나(변경 내용 손실) 나가기 전에 입력 내용을 복사할 수 있습니다.
editor-lease-taken-description = 다른 편집자가 페이지 편집 잠금을 가져가 저장이 거부되었습니다. 잠금을 되찾으면 현재 버전을 기준으로 편집 세션이 다시 시작됩니다. 또는 편집기를 나갈 수 있습니다.
editor-lease-edit-anyway = 강제로 편집
editor-lease-cancel = 취소
editor-lease-view-page = 현재 페이지 보기
editor-lease-reload = 편집기 다시 불러오기
editor-lease-copy-text = 내용 복사
editor-lease-close = 닫기
editor-lease-leave = 편집기 나가기
editor-lease-dialog-title = 페이지 편집 잠금
