### Basic Error HTML templates

basic-error-site-slug = <h1>이 주소에는 { -service-name } 사이트가 없습니다</h1>
    <p>
      사이트 <a href="https://{ $slug }.{ $main_domain }/"><code>{ $slug }.{ $main_domain }</code></a>은(는) 존재하지 않습니다.
    </p>

    <p>
      이 사이트를 만들까요? 그렇다면 <a href="https://www.{ $main_domain }/new-site">새 사이트 만들기</a> 페이지에서 주소 <code>{ $slug }.{ $main_domain }</code>를 사용할 수 있습니다.
    </p>

    <p>
      <a href="https://{ $main_domain }/">{ -service-name }</a>으로 돌아가기.
    </p>

    .title = 사이트를 찾을 수 없음 - { -service-name }

basic-error-site-custom = <h1>이 주소에는 { -service-name } 사이트가 없습니다</h1>
    <p>
      사용자 지정 도메인 <a href="https://{ $custom_domain }/"><code>{ $custom_domain }</code></a>을(를) 사용하는 사이트가 없습니다.
    </p>

    <p>
      <a href="https://{ $main_domain }/">{ -service-name }</a>으로 돌아가기.
    </p>

    .title = 사이트를 찾을 수 없음 - { -service-name }

basic-error-page-slug = <h1>이 페이지는 존재하지 않습니다</h1>
    <p>요청한 페이지가 존재하지 않습니다.</p>

    <p>
      <a href="https://{ $domain }/">사이트 메인 페이지</a>로 돌아가기.
    </p>

    .title = 페이지를 찾을 수 없음 - { $domain }

basic-error-page-fetch = <h1>페이지 데이터를 가져올 수 없습니다</h1>
    <p>
      서버 오류: <a href="https://{ $domain }/{ $page_slug }"><code>{ $domain }/{ $page_slug }</code></a>의 페이지 데이터를 불러올 수 없습니다.
    </p>

    <p>
      <a href="https://{ $domain }/{ $page_slug }">페이지</a> 또는 <a href="https://{ $domain }/">사이트 메인 페이지</a>로 돌아가기.
    </p>

    .title = 서버 오류 - { $domain }

basic-error-file-name = <h1>이 파일은 존재하지 않습니다</h1>
    <p>
      페이지 <code>{ $domain }/{ $page_slug }</code>의 파일 <code>{ $filename }</code>은(는) 존재하지 않습니다.
    </p>

    <p>
      <a href="https://{ $domain }/{ $page_slug }">페이지</a> 또는 <a href="https://{ $domain }/">사이트 메인 페이지</a>로 돌아가기.
    </p>

    .title = 페이지를 찾을 수 없음 - { $domain }

basic-error-file-fetch = <h1>파일 데이터를 가져올 수 없습니다</h1>
    <p>
      서버 오류: 페이지 <code>{ $domain }/{ $page_slug }</code>의 파일 <code>{ $filename }</code> 데이터를 불러올 수 없습니다.
    </p>

    <p>
      <a href="https://{ $domain }/{ $page_slug }">페이지</a> 또는 <a href="https://{ $domain }/">사이트 메인 페이지</a>로 돌아가기.
    </p>

    .title = 서버 오류 - { $domain }

basic-error-text-block = <h1>호스팅된 텍스트 블록이 올바르지 않습니다</h1>
    <p>
      { $reason ->
        [missing] 인덱스 <code>{ $index }</code>의 { $type ->
          [code] 코드
          [html] HTML
          *[error] 텍스트
        } 블록이 존재하지 않습니다.
        [invalid] 지정된 인덱스 <code>{ $index }</code>은(는) 올바르지 않습니다.
        [fetch] 이 텍스트 블록 데이터를 불러올 수 없습니다.
        *[error] 알 수 없는 기본 오류 사유: { $reason }
      }
    </p>

    <p>
      <a href="https://{ $domain }/">사이트 메인 페이지</a>로 돌아가기.
    </p>

    .title = 텍스트 블록 오류 - { $domain }

basic-error-file-root = <h1>올바르지 않은 경로</h1>
    <p>
      { -service-name }은(는) 사용자 생성 데이터를 <code>{ $files_domain }</code>에서 제공하지만, 이것은 올바른 URL이 아닙니다.
    </p>

    <p>
      <a href="https://{ $main_domain }/">{ -service-name }</a>으로 돌아가기.
    </p>

    .title = { -service-name }

basic-error-blob-fetch = <h1>Blob 데이터를 가져올 수 없습니다</h1>
    <p>
      서버 오류: S3 해시 <code>{ $s3_hash }</code>의 Blob을 불러올 수 없습니다.
    </p>

    .title = 서버 오류

basic-error-user-fetch = <h1>사용자 데이터를 가져올 수 없습니다</h1>
    <p>
      서버 오류: ID <code>{ $user_id }</code>의 사용자를 불러올 수 없습니다.
    </p>

    .title = 서버 오류

basic-error-user-avatar = <h1>사용자 아바타를 가져올 수 없습니다</h1>
    <p>
      서버 오류: 사용자 ID <code>{ $user_id }</code>의 사용자 아바타를 불러올 수 없습니다.
    </p>

    .title = 서버 오류
