### Basic Error HTML templates

basic-error-site-slug = <h1>Pod tym adresem nie istnieje witryna { -service-name }</h1>
    <p>
      Witryna <a href="https://{ $slug }.{ $main_domain }/"><code>{ $slug }.{ $main_domain }</code></a> nie istnieje.
    </p>

    <p>
      Czy chcesz utworzyć tę witrynę? Jeśli tak, możesz <a href="https://www.{ $main_domain }/new-site">utworzyć nową witrynę</a> pod adresem <code>{ $slug }.{ $main_domain }</code>.
    </p>

    <p>
      Wróć do witryny <a href="https://{ $main_domain }/">{ -service-name }</a>.
    </p>

    .title = Nie ma takiej witryny - { -service-name }

basic-error-site-custom = <h1>Pod tym adresem nie istnieje witryna { -service-name }</h1>
    <p>
      Żadna witryna nie używa domeny niestandardowej <a href="https://{ $custom_domain }/"><code>{ $custom_domain }</code></a>.
    </p>

    <p>
      Wróć do witryny <a href="https://{ $main_domain }/">{ -service-name }</a>.
    </p>

    .title = Nie ma takiej witryny - { -service-name }

basic-error-page-slug = <h1>Ta strona nie istnieje</h1>
    <p>Żądana strona nie istnieje.</p>

    <p>
      Wróć na <a href="https://{ $domain }/">stronę główną witryny</a>.
    </p>

    .title = Nie ma takiej strony - { $domain }

basic-error-page-fetch = <h1>Nie udało się pobrać danych strony</h1>
    <p>
      Błąd serwera: nie udało się wczytać danych strony <a href="https://{ $domain }/{ $page_slug }"><code>{ $domain }/{ $page_slug }</code></a>.
    </p>

    <p>
      Wróć na <a href="https://{ $domain }/{ $page_slug }">stronę</a> albo na <a href="https://{ $domain }/">stronę główną witryny</a>.
    </p>

    .title = Błąd serwera - { $domain }

basic-error-file-name = <h1>Ten plik nie istnieje</h1>
    <p>
      Plik <code>{ $filename }</code> na stronie <code>{ $domain }/{ $page_slug }</code> nie istnieje.
    </p>

    <p>
      Wróć na <a href="https://{ $domain }/{ $page_slug }">stronę</a> albo na <a href="https://{ $domain }/">stronę główną witryny</a>.
    </p>

    .title = Nie ma takiej strony - { $domain }

basic-error-file-fetch = <h1>Nie udało się pobrać danych pliku</h1>
    <p>
      Błąd serwera: nie udało się wczytać danych pliku <code>{ $filename }</code> ze strony <code>{ $domain }/{ $page_slug }</code>.
    </p>

    <p>
      Wróć na <a href="https://{ $domain }/{ $page_slug }">stronę</a> albo na <a href="https://{ $domain }/">stronę główną witryny</a>.
    </p>

    .title = Błąd serwera - { $domain }

basic-error-text-block = <h1>Nieprawidłowy hostowany blok tekstowy</h1>
    <p>
      { $reason ->
        [missing] Nie istnieje blok { $type ->
          [code] kodu
          [html] HTML
          *[error] tekstu
        } o indeksie <code>{ $index }</code>.
        [invalid] Podany indeks <code>{ $index }</code> jest nieprawidłowy.
        [fetch] Nie udało się wczytać danych tego bloku tekstowego.
        *[error] Nieznana przyczyna błędu podstawowego: { $reason }
      }
    </p>

    <p>
      Wróć na <a href="https://{ $domain }/">stronę główną witryny</a>.
    </p>

    .title = Błąd bloku tekstowego - { $domain }

basic-error-file-root = <h1>Nieprawidłowa trasa</h1>
    <p>
      { -service-name } udostępnia dane wytworzone przez użytkowników z domeny <code>{ $files_domain }</code>, ale nie jest to prawidłowy adres URL.
    </p>

    <p>
      Wróć do witryny <a href="https://{ $main_domain }/">{ -service-name }</a>.
    </p>

    .title = { -service-name }

basic-error-blob-fetch = <h1>Nie udało się pobrać danych obiektu blob</h1>
    <p>
      Błąd serwera: nie udało się wczytać obiektu blob o skrócie S3 <code>{ $s3_hash }</code>.
    </p>

    .title = Błąd serwera

basic-error-user-fetch = <h1>Nie udało się pobrać danych użytkownika</h1>
    <p>
      Błąd serwera: nie udało się wczytać użytkownika o identyfikatorze <code>{ $user_id }</code>.
    </p>

    .title = Błąd serwera

basic-error-user-avatar = <h1>Nie udało się pobrać awatara użytkownika</h1>
    <p>
      Błąd serwera: nie udało się wczytać awatara użytkownika o identyfikatorze <code>{ $user_id }</code>.
    </p>

    .title = Błąd serwera
