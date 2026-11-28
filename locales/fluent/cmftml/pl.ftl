### CodeMirror FTML Extension

cmftml-undocumented-block = Ten blok jest prawidłowy, ale nie ma jeszcze dokumentacji.

## Linting

cmftml-lint =
  .warning-source = ftml({ $rule } = { $kind } w { $token }) [{ NUMBER($from, useGrouping: 0) }, { NUMBER($to, useGrouping: 0) }]

  .recursion-depth-exceeded = Zbyt dużo rekurencji w znacznikach.

  .end-of-input = Reguły typu „{ $rule }” nie udało się przetworzyć przed końcem dokumentu.

  .no-rules-matched = Ciąg „{ $slice }” niczemu nie odpowiada i zostanie wyrenderowany jako zwykły tekst.

  .rule-failed = Reguła „{ $rule }” nie dopasowała niczego w tym miejscu i trzeba było użyć innej reguły.

  .not-start-of-line = Reguła „{ $rule }” nie dopasowała niczego w tym miejscu, ponieważ może dopasowywać tylko od początku nowego wiersza.

  .invalid-include = To włączenie jest nieprawidłowe i nie zostanie wyrenderowane.

  .list-empty = Ta lista nie zawiera żadnych elementów.

  .list-contains-non-item = Ta lista ma bezpośrednie węzły potomne, które nie są blokami list-item.

  .list-item-outside-list = Ten element list-item nie znajduje się w liście.

  .list-depth-exceeded = Ta lista jest zagnieżdżona zbyt głęboko i nie może zostać wyrenderowana.

  .table-contains-non-row = Ta tabela ma bezpośrednie węzły potomne, które nie są wierszami tabeli.

  .table-row-contains-non-cell = Ten wiersz tabeli ma bezpośrednie węzły potomne, które nie są komórkami.

  .table-row-outside-table = Ten wiersz tabeli nie znajduje się w tabeli.

  .table-cell-outside-table = Ta komórka tabeli nie znajduje się w wierszu tabeli.

  .footnotes-nested = Ten przypis jest nieprawidłowy, ponieważ znajduje się wewnątrz innego przypisu.

  .blockquote-depth-exceeded = Ten cytat blokowy jest zagnieżdżony zbyt głęboko i nie może zostać wyrenderowany.

  .no-such-block = Nieznany blok „{ $slice }”.

  .block-disallows-star = Blok „{ $slice }” nie obsługuje wywołania z gwiazdką (początkowym znakiem „*”).

  .block-disallows-score = Blok „{ $slice }” nie obsługuje wywołania z podkreśleniem (początkowym znakiem „_”).

  .block-missing-name = Blok „{ $slice }” wymaga nazwy lub wartości, ale nie podano żadnej.

  .block-missing-close-brackets = W tym bloku brakuje zamykających nawiasów „]]”.

  .black-malformed-arguments = Blok „{ $slice }” ma nieprawidłowo zbudowane argumenty.

  .block-missing-arguments = W bloku „{ $slice }” brakuje co najmniej jednego wymaganego argumentu.

  .block-expected-end = Blok typu „{ $rule }” powinien zakończyć się najpóźniej w tym miejscu.

  .block-end-mismatch = Blok typu „{ $rule }” powinien zakończyć się tutaj, a nie w „{ $slice }”.

  .no-such-module = Nieznany moduł „{ $slice }”.

  .module-missing-name = Należy podać nazwę modułu.

  .no-such-page = Strona „{ $slice }” nie istnieje.

  .invalid-url = Adres URL „{ $slice }” jest nieprawidłowy.

## Block Acceptance

cmftml-accepts =
  .star =
    Ten blok akceptuje prefiks „*” (gwiazdkę).
    Efekt użycia tego prefiksu zależy od bloku.

  .score =
    Ten blok akceptuje sufiks „_” (podkreślenie),
    który usuwa początkowe i końcowe znaki nowego wiersza.

  .newlines =
    Ten blok akceptuje znaki nowego wiersza między węzłem początkowym i końcowym.

  .html-attributes =
    Ten blok akceptuje ogólne atrybuty/argumenty HTML.
    Atrybuty HTML są ograniczane listą dozwolonych, ale mimo to można używać większości z nich.

## Block Argument Types

cmftml-argument-none = NONE
  .info = Ten blok nie akceptuje żadnych argumentów.

cmftml-argument-value = VALUE
  .info = Ten blok akceptuje tekst między początkiem i końcem węzła.

cmftml-argument-map = MAP
  .info = Ten blok akceptuje argumenty.

cmftml-argument-value-map = VALUE+MAP
  .info = Ten blok akceptuje tekst, a po spacji argumenty.

## Block Body Types

cmftml-body-none = NONE
  .info = Ten blok nie ma treści i nie wymaga węzła końcowego.

cmftml-body-raw = RAW
  .info = Ten blok akceptuje treść, ale interpretuje ją jako surowy tekst.

cmftml-body-elements = ELEMENTS
  .info = Ten blok akceptuje treść i może zagnieżdżać w niej dodatkowe elementy.

cmftml-body-other = OTHER
  .info = Ten blok używa specjalnej składni, której nie można łatwo skategoryzować.
