### Base localization / generic strings
### Messages should only go into this file if they are widely used,
### or are particularly important to localize.

## Terms

-service-name = Wikijump

## Special

# Shows whenever a message is still being loaded
message-loading = Ładowanie...

goto-home = Przejdź na stronę główną

goto-service = Przejdź do serwisu { -service-name }

base-title = { $title } | { -service-name }

navigated-to = Przejście do { $path }

## Generic

about = Informacje

about-info = Informacje o platformie
    .backend = Backend
    .frontend = Frontend
    .package-name = Nazwa pakietu
    .package-description = Opis pakietu
    .package-license = Licencja pakietu
    .package-repository = Repozytorium pakietu
    .package-version = Wersja pakietu
    .rustc-version = Wersja Rustc
    .cargo-version = Wersja Cargo
    .built-at = Zbudowano
    .git-commit = Commit Git
    .ftml-commit = Commit FTML
    .blurb = Wikijump to wolna, otwartoźródłowa platforma do wspólnego tworzenia fikcji i światów: nowoczesny zamiennik Wikidotu rozwijany przez zespół Wikijump i społeczność SCP.
    .blog = Blog Wikijump
    .node-version = Wersja Node
    .pnpm-version = Wersja Pnpm
account = Konto
alt-title = Tytuł alternatywny
applications = Aplikacje
avatar = Awatar
breadcrumbs = Nawigacja okruszkowa
cancel = Anuluj
change = Zmień
children = Strony podrzędne
clear = Wyczyść
close = Zamknij
confirm = Potwierdź
dashboard = Panel sterowania
delete = Usuń
docs = Dokumentacja
download = Pobierz
edit = Edytuj
editor = Edytor
error = Błąd
files = Pliki
footer = Stopka strony
general = Ogólne
header = Nagłówek strony
help = Pomoc
history = Historia
inbox = Skrzynka odbiorcza
invitations = Zaproszenia
layout = Układ
load = Wczytaj
main-content = Główna zawartość
messages = Wiadomości
move = Przenieś
navigation = Nawigacja
notifications = Powiadomienia
options = Opcje
parents = Strony nadrzędne
preview = Podgląd
privacy = Prywatność
profile = Profil
publish = Opublikuj
restore = Przywróć
reveal-sidebar = Rozwiń pasek boczny
save = Zapisz
security = Bezpieczeństwo
send = Wyślij
sent = Wysłano
settings = Ustawienia
sidebar = Pasek boczny
tags = Tagi
terminology = Terminologia
terms-conditions = Regulamin
title = Tytuł
upload = Prześlij
view = Zobacz
vote = Oceń

search = Szukaj
  .placeholder = Szukaj...

## Generic Authentication

login = Zaloguj się
  .toast = Zalogowano.

logout = Wyloguj się
  .toast = Wylogowano.

register = Zarejestruj się
  .toast = Utworzono konto.
  .disabled-notice = Tworzenie kont nie jest dostępne w tej instancji Wikijump. Konta są tworzone przez administratorów instancji.
  .legal-notice = Tworząc konto, akceptujesz nasz{ " " }
  .legal-terms = Regulamin
  .legal-conjunction = { " " }oraz{ " " }
  .legal-privacy = Politykę prywatności
  .legal-suffix = .

specifier = Email lub nazwa użytkownika
  .placeholder = Wprowadź email lub nazwę użytkownika...

mfa-code = Kod MFA

username = Nazwa użytkownika
  .placeholder = Wprowadź nazwę użytkownika...
  .info = Możesz ją później zmienić.

email = Email
  .placeholder = Wprowadź adres email...
  .info = Twój adres email jest prywatny.

password = Hasło
  .placeholder = Wprowadź hasło...

confirm-password = Potwierdź hasło

forgot-password = Nie pamiętam hasła
  .question = Nie pamiętasz hasła?

reset-password = Zresetuj hasło

remember-me = Zapamiętaj mnie

create-account = Utwórz konto

field-required = To pole jest wymagane

characters-left = { $count ->
  [1] Pozostał 1 znak
  *[other] Liczba pozostałych znaków: { $count }
}

hold-to-show-password = Przytrzymaj, aby pokazać hasło

## Errors

error-404 =
  .generic = Żądana treść nie została znaleziona.
  .page = Żądana strona nie została znaleziona.
  .user = Żądany użytkownik nie został znaleziony.

error-form =
  .missing-fields = Wypełnij wszystkie wymagane pola.
  .password-mismatch = Hasła się nie zgadzają.
  .password-too-short = Hasło musi zawierać co najmniej 15 znaków.
  .email-invalid = Adres email jest nieprawidłowy.

error-api =
  .GENERIC = Coś poszło nie tak z Twoim żądaniem.
  .INTERNAL = Wystąpił wewnętrzny błąd serwera. Spróbuj ponownie później.
  .NO_CONNECTION = Brak połączenia z internetem.
  .BAD_SYNTAX = Serwer nie mógł zrozumieć żądania.
  .FORBIDDEN = Nie masz uprawnień do wykonania tej czynności.
  .NOT_FOUND = Żądana treść nie została znaleziona.
  .CONFLICT = Żądana treść jest w konflikcie z inną treścią.

  .ACCOUNT_ALREADY_VERIFIED = To konto zostało już zweryfikowane.
  .ACCOUNT_NO_EMAIL = To konto nie ma przypisanego adresu email.
  .ALREADY_LOGGED_IN = Już zalogowano.
  .FAILED_TO_UPDATE_PROFILE = Nie udało się zaktualizować profilu.
  .INVALID_AVATAR = Przesłany plik nie jest prawidłowym obrazem.
  .INVALID_EMAIL = Adres email jest nieprawidłowy.
  .INVALID_LANGUAGE_CODE = Kod języka jest nieprawidłowy.
  .INVALID_PASSWORD = Hasło jest nieprawidłowe.
  .INVALID_SESSION = Sesja wygasła. Zaloguj się ponownie.
  .INVALID_SPECIFIER = Podano nieprawidłowy adres email lub nieprawidłową nazwę użytkownika.
  .INVALID_USERNAME = Nazwa użytkownika jest nieprawidłowa.
  .LOGIN_FAILED = Nie udało się zalogować. Sprawdź dane logowania.
  .NOT_LOGGED_IN = Musisz się zalogować.
  .UNKNOWN_EMAIL = Nie istnieje konto przypisane do tego adresu email.
  .UNKNOWN_USER = Nie istnieje konto z taką nazwą użytkownika.
  .WRONG_PASSWORD = Hasło jest niepoprawne.

error-418 = Jestem czajnikiem
### Editor UI (ED-9)

editor-toolbar-label = Pasek edytora źródła Wikitext
editor-toolbar-note = Edycja źródła: przyciski wstawiają lub otaczają źródło Wikidot; nie tworzą WYSIWYG, a tekst źródłowy pozostaje nadrzędny. Skróty: Ctrl/Cmd+B pogrubienie, Ctrl/Cmd+I kursywa, Ctrl/Cmd+K odnośnik. Pozostałe skróty są w podpowiedziach przycisków.
editor-toolbar-heading1 = Nagłówek poziomu 1
editor-toolbar-heading2 = Nagłówek poziomu 2
editor-toolbar-heading3 = Nagłówek poziomu 3
editor-toolbar-heading4 = Nagłówek poziomu 4
editor-toolbar-heading5 = Nagłówek poziomu 5
editor-toolbar-heading6 = Nagłówek poziomu 6
editor-toolbar-bold = Pogrubienie
editor-toolbar-italic = Kursywa
editor-toolbar-strike = Przekreślenie
editor-toolbar-teletype = Font maszynowy
editor-toolbar-quote = Blok cytatu
editor-toolbar-bulleted-list = Lista wypunktowana
editor-toolbar-numbered-list = Lista numerowana
editor-toolbar-horizontal-rule = Linia pozioma
editor-toolbar-raw = Surowe teksty
editor-toolbar-link = Wstaw odnośnik
editor-toolbar-image = Wstaw obraz
editor-toolbar-table = Wstaw szkielet tabeli
editor-toolbar-code = Blok kodu
editor-toolbar-footnote = Przypis
editor-toolbar-math = Blok matematyczny
editor-toolbar-inline-math = Wbudowany wzór
editor-hint-notice = Heurystyczne ostrzeżenia edytora: { $count } — to nie są błędy renderowania.
editor-link-prompt = Cel odnośnika
editor-image-prompt = Źródło obrazu
editor-preview-current = Podgląd jest aktualny.
editor-preview-stale = Podgląd jest nieaktualny. Oczekiwanie na renderowanie ostatniej zmiany.
editor-preview-loading = Renderowanie podglądu…
editor-preview-paused = Podgląd wstrzymany. Zmiany nie są renderowane.
editor-preview-error = Renderowanie podglądu nie powiodło się. Edycja i zapis są nadal dostępne.
editor-preview-timeout = Renderowanie podglądu przekroczyło limit czasu.
editor-preview-failed = Renderowanie podglądu nie powiodło się.
editor-preview-failure = Renderowanie podglądu nie powiodło się: { $message }
editor-preview-pause = Wstrzymaj podgląd
editor-preview-resume = Wznów podgląd
editor-preview-retry = Ponów podgląd
editor-back-to-source = Wróć do źródła
editor-properties-heading = Właściwości strony
editor-properties-title = Tytuł
editor-properties-alt-title = Alternatywny tytuł
editor-properties-layout = Układ
editor-properties-default-layout = Domyślny
editor-properties-layout-hint = Zmień układ w menu Opcje strony.
editor-properties-template = Początkowy szablon
editor-properties-no-template = Brak szablonu
editor-properties-tags = Tagi
editor-properties-comments = Komentarz do wersji
editor-properties-parent-heading = Przeniesienie w drzewie stron (rodzic)
editor-properties-parent-description = Zmiana rodzica to strukturalne przeniesienie w drzewie stron, nie edycja metadanych. Jest stosowana po zapisie treści, tworzy własną wersję i wymaga uprawnień do edycji tej strony.
editor-properties-parent-denied = Nie masz uprawnień do przeniesienia tej strony w drzewie. Poproś administratora witryny o uprawnienia do edycji przed zmianą rodzica.
editor-properties-parent-load-error = Nie udało się wczytać aktualnego rodzica. Odśwież edytor i spróbuj ponownie.
editor-properties-parent = Strona nadrzędna
editor-properties-parent-hint-create = Stosowane przy tworzeniu strony. Wiele rodziców rozdziel spacjami.
editor-properties-parent-hint-existing = Aktualni rodzice: { $parents }. Pozostawienie pola pustego usuwa wszystkich rodziców. Wiele rodziców rozdziel spacjami.
editor-properties-no-parents = brak
editor-properties-retry-move = Ponów przeniesienie w drzewie stron
editor-section-heading = Edytuj sekcję
editor-create-heading = Utwórz
editor-edit-heading = Edytuj
editor-checking-permission = Sprawdzanie uprawnień do edycji…
editor-acquiring-lock = Uzyskiwanie blokady edycji strony…
editor-lock-conflict = Tę stronę edytuje inny użytkownik.
editor-lock-superseded = Inny użytkownik przejął blokadę edycji. Zapis będzie odrzucany do czasu odzyskania blokady.
editor-take-lock-back = Odzyskaj blokadę
editor-draft-sync-error = Wersja robocza strony nie jest zsynchronizowana: { $message }
editor-draft-check-error = Nie udało się sprawdzić wersji roboczej strony.
editor-draft-sync-failure = Nie udało się zsynchronizować wersji roboczej strony.
editor-draft-discard-failure = Nie udało się odrzucić wersji roboczej strony.
editor-check-properties = Sprawdź właściwości strony.
editor-save-content-and-parent = Zapisywanie treści strony, a następnie stosowanie przeniesienia w drzewie…
editor-save-properties = Zapisywanie właściwości strony…
editor-save-parent = Treść zapisana. Stosowanie przeniesienia w drzewie stron…
editor-save-parent-apply = Stosowanie przeniesienia w drzewie stron…
editor-parent-move-failure = Żądanie przeniesienia w drzewie stron nie powiodło się. Sprawdź stronę nadrzędną i spróbuj ponownie.
editor-save-parent-success = Właściwości strony i przeniesienie w drzewie zostały zapisane.
editor-lock-request-failure = Żądanie blokady edycji nie powiodło się.
editor-draft-title = Dostępna jest zapisana wersja robocza
editor-draft-description = Istnieje wersja robocza tej strony. Nie została opublikowana jako nowa wersja, a aktualny tekst strony pozostaje w edytorze.
editor-draft-title-label = Tytuł wersji roboczej:
editor-draft-choice = Możesz przywrócić wersję roboczą do edytora lub ją odrzucić. Dopóki nie wybierzesz, wersja robocza nie zostanie zmieniona.
editor-draft-restore = Przywróć wersję roboczą
editor-draft-discard = Odrzuć wersję roboczą
editor-draft-restored = Wersja robocza została przywrócona do edytora.
editor-draft-discarded = Wersja robocza została odrzucona.
editor-save-result = Strona została zapisana.
editor-save-partial = Treść została zapisana, ale przeniesienie w drzewie stron nie zostało zastosowane.
editor-lease-title-conflict = Strona jest edytowana
editor-lease-title-changed = Strona została zmieniona
editor-lease-title-taken = Blokada edycji została przejęta
editor-lease-conflict-description = Wygląda na to, że strona jest obecnie edytowana przez innego użytkownika. Szczegóły poniżej:
editor-lease-conflict-user = Użytkownik { $user } — tryb blokady: { $mode } — pozostały czas: { $remaining }
editor-lease-conflict-choice = Możesz poczekać na wygaśnięcie blokady lub wymusić edycję i przejąć blokadę. Wtedy drugi edytor nie będzie mógł zapisać.
editor-lease-changed-description = Strona została zmieniona po rozpoczęciu edycji, więc zapis został odrzucony. Twój tekst nie został scalony z aktualną wersją.
editor-lease-changed-choice = Możesz wyświetlić aktualną stronę, odświeżyć edytor z aktualnym tekstem (tracąc zmiany) lub skopiować swój tekst przed wyjściem.
editor-lease-taken-description = Inny edytor przejął blokadę edycji strony, więc zapis został odrzucony. Odzyskanie blokady wznawia sesję edycji od aktualnej wersji lub możesz opuścić edytor.
editor-lease-edit-anyway = Edytuj mimo to
editor-lease-cancel = Anuluj
editor-lease-view-page = Wyświetl aktualną stronę
editor-lease-reload = Odśwież edytor
editor-lease-copy-text = Kopiuj mój tekst
editor-lease-close = Zamknij
editor-lease-leave = Opuść edytor
editor-lease-dialog-title = Blokada edycji strony
