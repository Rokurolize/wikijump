### Basic Error HTML templates

basic-error-site-slug = <h1>このアドレスには{ -service-name }のサイトがありません</h1>
    <p>
      サイト <a href="https://{ $slug }.{ $main_domain }/"><code>{ $slug }.{ $main_domain }</code></a> は存在しません。
    </p>

    <p>
      このサイトを作成しますか？作成する場合は、<a href="https://www.{ $main_domain }/new-site">新しいサイトを作成</a>する際に、アドレス <code>{ $slug }.{ $main_domain }</code> を指定できます。
    </p>

    <p>
      <a href="https://{ $main_domain }/">{ -service-name }</a>に戻る。
    </p>

    .title = サイトが見つかりません - { -service-name }

basic-error-site-custom = <h1>このアドレスには{ -service-name }のサイトがありません</h1>
    <p>
      カスタムドメイン <a href="https://{ $custom_domain }/"><code>{ $custom_domain }</code></a> を持つサイトはありません。
    </p>

    <p>
      <a href="https://{ $main_domain }/">{ -service-name }</a>に戻る。
    </p>

    .title = サイトが見つかりません - { -service-name }

basic-error-page-slug = <h1>このページは存在しません</h1>
    <p>リクエストされたページは存在しません。</p>

    <p>
      <a href="https://{ $domain }/">サイトのメインページ</a>に戻る。
    </p>

    .title = ページが見つかりません - { $domain }

basic-error-page-fetch = <h1>ページデータを取得できません</h1>
    <p>
      サーバーエラー: <a href="https://{ $domain }/{ $page_slug }"><code>{ $domain }/{ $page_slug }</code></a> のページデータを読み込めませんでした。
    </p>

    <p>
      <a href="https://{ $domain }/{ $page_slug }">ページ</a>、または<a href="https://{ $domain }/">サイトのメインページ</a>に戻る。
    </p>

    .title = サーバーエラー - { $domain }

basic-error-file-name = <h1>このファイルは存在しません</h1>
    <p>
      ページ <code>{ $domain }/{ $page_slug }</code> のファイル <code>{ $filename }</code> は存在しません。
    </p>

    <p>
      <a href="https://{ $domain }/{ $page_slug }">ページ</a>、または<a href="https://{ $domain }/">サイトのメインページ</a>に戻る。
    </p>

    .title = ページが見つかりません - { $domain }

basic-error-file-fetch = <h1>ファイルデータを取得できません</h1>
    <p>
      サーバーエラー: ページ <code>{ $domain }/{ $page_slug }</code> のファイル <code>{ $filename }</code> のデータを読み込めませんでした。
    </p>

    <p>
      <a href="https://{ $domain }/{ $page_slug }">ページ</a>、または<a href="https://{ $domain }/">サイトのメインページ</a>に戻る。
    </p>

    .title = サーバーエラー - { $domain }

basic-error-text-block = <h1>ホストされたテキストブロックが無効です</h1>
    <p>
      { $reason ->
        [missing] インデックス <code>{ $index }</code> の{ $type ->
          [code] コード
          [html] HTML
          *[error] テキスト
        }ブロックは存在しません。
        [invalid] 指定されたインデックス <code>{ $index }</code> は無効です。
        [fetch] このテキストブロックのデータを読み込めませんでした。
        *[error] 不明な基本エラーの理由: { $reason }
      }
    </p>

    <p>
      <a href="https://{ $domain }/">サイトのメインページ</a>に戻る。
    </p>

    .title = テキストブロックエラー - { $domain }

basic-error-file-root = <h1>無効なルートです</h1>
    <p>
      { -service-name }はユーザーが生成したデータを <code>{ $files_domain }</code> から配信しますが、これは有効なURLではありません。
    </p>

    <p>
      <a href="https://{ $main_domain }/">{ -service-name }</a>に戻る。
    </p>

    .title = { -service-name }

basic-error-blob-fetch = <h1>Blobデータを取得できません</h1>
    <p>
      サーバーエラー: S3ハッシュ <code>{ $s3_hash }</code> のBlobを読み込めませんでした。
    </p>

    .title = サーバーエラー

basic-error-user-fetch = <h1>ユーザーデータを取得できません</h1>
    <p>
      サーバーエラー: ID <code>{ $user_id }</code> のユーザーを読み込めませんでした。
    </p>

    .title = サーバーエラー

basic-error-user-avatar = <h1>ユーザーアバターを取得できません</h1>
    <p>
      サーバーエラー: ユーザーID <code>{ $user_id }</code> のユーザーアバターを読み込めませんでした。
    </p>

    .title = サーバーエラー
