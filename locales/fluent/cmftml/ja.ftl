### CodeMirror FTML Extension

cmftml-undocumented-block = このブロックは有効ですが、まだ説明が書かれていません。

## Linting

cmftml-lint =
  .warning-source = ftml({ $rule } = { $kind }、位置: { $token }) [{ NUMBER($from, useGrouping: 0) }, { NUMBER($to, useGrouping: 0) }]

  .recursion-depth-exceeded = マークアップの再帰が深すぎます。

  .end-of-input = ドキュメントの終わりに達するまでに、'{ $rule }' 型のルールを処理できませんでした。

  .no-rules-matched = 文字列 '{ $slice }' はどのルールにも一致しないため、通常のテキストとしてレンダリングされます。

  .rule-failed = この位置ではルール '{ $rule }' に一致しなかったため、別のルールにフォールバックしました。

  .not-start-of-line = ルール '{ $rule }' は新しい行の先頭でのみ一致するため、この位置では一致しません。

  .invalid-include = このインクルードは無効なため、レンダリングされません。

  .list-empty = このリストは空です。

  .list-contains-non-item = このリストの直接の子に、list-item ブロックではないものがあります。

  .list-item-outside-list = この list-item はリスト内にありません。

  .list-depth-exceeded = このリストは入れ子が深すぎるため、レンダリングできません。

  .table-contains-non-row = このテーブルの直接の子に、テーブル行ではないものがあります。

  .table-row-contains-non-cell = このテーブル行の直接の子に、セルではないものがあります。

  .table-row-outside-table = このテーブル行はテーブル内にありません。

  .table-cell-outside-table = このテーブルセルはテーブル行内にありません。

  .footnotes-nested = この脚注は別の脚注の内側にあるため無効です。

  .blockquote-depth-exceeded = この引用ブロックは入れ子が深すぎるため、レンダリングできません。

  .no-such-block = 不明なブロック '{ $slice }' です。

  .block-disallows-star = ブロック '{ $slice }' はスター呼び出し（先頭の '*' 文字）をサポートしていません。

  .block-disallows-score = ブロック '{ $slice }' はスコア呼び出し（先頭の '_' 文字）をサポートしていません。

  .block-missing-name = ブロック '{ $slice }' には名前/値が必要ですが、指定されていません。

  .block-missing-close-brackets = このブロックには閉じ括弧 ']]' がありません。

  .black-malformed-arguments = ブロック '{ $slice }' の引数の形式が不正です。

  .block-missing-arguments = ブロック '{ $slice }' に必要な引数が1つ以上不足しています。

  .block-expected-end = '{ $rule }' 型のブロックは、少なくともこの位置までに終了すると想定されていました。

  .block-end-mismatch = '{ $rule }' 型のブロックは '{ $slice }' ではなく、この位置で終了すると想定されていました。

  .no-such-module = 不明なモジュール '{ $slice }' です。

  .module-missing-name = モジュール名が指定される必要があります。

  .no-such-page = ページ '{ $slice }' は存在しません。

  .invalid-url = URL '{ $slice }' は無効です。

## Block Acceptance

cmftml-accepts =
  .star =
    このブロックは '*'（スター）接頭辞を受け付けます。
    この接頭辞を指定した場合の効果はブロックによって異なります。

  .score =
    このブロックは '_'（スコア）接尾辞を受け付けます。
    この接尾辞は先頭と末尾の改行を取り除きます。

  .newlines =
    このブロックは開始ノードと終了ノードの間の改行を受け付けます。

  .html-attributes =
    このブロックは一般的な HTML 属性/引数を受け付けます。
    HTML 属性にはホワイトリストがありますが、それでも多くの属性を使用できます。

## Block Argument Types

cmftml-argument-none = NONE
  .info = このブロックは引数を受け付けません。

cmftml-argument-value = VALUE
  .info = このブロックはノードの開始位置と終了位置の間のテキストを受け付けます。

cmftml-argument-map = MAP
  .info = このブロックは引数を受け付けます。

cmftml-argument-value-map = VALUE+MAP
  .info = このブロックはテキストを受け付け、テキストに続けて空白を挟み、引数を受け付けます。

## Block Body Types

cmftml-body-none = NONE
  .info = このブロックには本文がなく、終了ノードも必要ありません。

cmftml-body-raw = RAW
  .info = このブロックは本文を受け付けますが、その本文を生のテキストとして解釈します。

cmftml-body-elements = ELEMENTS
  .info = このブロックは本文を受け付け、その内側に追加の要素を入れ子にできます。

cmftml-body-other = OTHER
  .info = このブロックは、簡単には分類できない特別な構文を持っています。
