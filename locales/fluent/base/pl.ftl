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
