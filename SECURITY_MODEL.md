# Wikijump 脅威モデル(Rokurolize/wikijump)

ステータス: ユーザー回答反映済み(2026-11-20)。「ユーザー回答」と記した項目はユーザー提供の事実、それ以外はコードからの推定。

## 1. システム概要と信頼境界

| コンポーネント | 対象コード | 役割 |
|---|---|---|
| **Framerail** | `framerail/src/**`, `framerail/server.ts` | SvelteKit のブラウザ向けアプリ。セッション Cookie `wikijump_token` の発行・検証、ブラウザ向け認可、Wikidot 互換の `ajax-module-connector.php` / `xml-rpc-api.php` / フィード / sitemap |
| **Deepwell API** | `deepwell/src/api.rs`, `deepwell/src/endpoints/**`, `deepwell/src/middleware/rpc_auth.rs` | 内部 JSON-RPC。全リクエストに共有 `DEEPWELL_RPC_TOKEN`(Bearer, 定数時間比較)を要求。登録済みミューテーションを独立に認可(多層防御) |
| **Deepwell サービス層** | `deepwell/src/services/**`, `deepwell/migrations/**` | ページ・リビジョン・ファイル・権限/ロール・メンバーシップ・フォーラム・投票・ジョブ(RSMQ)・BlobService(S3)・レンダリング(FTML) |
| **認証・セッション** | `framerail/src/lib/server/auth/**`, `deepwell/src/services/{authentication,session,mfa,password.rs,authorization_token,email}` | ログイン、MFA、パスワードリセット、メール検証トークン、セッション更新 |
| **WWS** | `wws/src/**` | ファイル専用ドメイン(`<site>.wjfiles.*`)で添付ファイル・アバター・テキストブロックを読み取り専用配信。サイト解決はリバースプロキシの内部ヘッダー `x-wikijump-*` に依存 |
| **インフラ** | `install/prod/**`, `install/common/**`, `install/dev/komodo/**` | Caddy(TLS、内部ヘッダー除去、Caddyfile 生成)、Docker、Komodo、Postgres、Valkey/Redis、S3 |
| **ローカル/検証ツール** | `install/local/**`, `install/standing/**`, `scripts/**` | ローカル開発スタック・Wikidot 互換性検証。本番経路ではない |

信頼境界:
1. ブラウザ ↔ Caddy ↔ Framerail(未信頼入力: HTTP リクエスト、Cookie、Host、wikitext)。
2. Framerail/WWS ↔ Deepwell(共有サービストークン。リクエストアクターは検証済みセッションから構築し、ペイロードのアクター ID は一致必須 — `deepwell/README.md`)。
3. Caddy ↔ WWS(`x-wikijump-site-id` 等の内部ヘッダー。クライアント送信の `X-Wikijump-*` は Caddy で除去する前提)。
4. メインドメイン(`wikijump_token` は親ドメイン Cookie)↔ ファイルドメイン(ユーザーアップロード HTML を配信。メインドメイン配下であってはならない — `docs/deployment/concepts.md`)。
5. ローカル作成アクター: `FRAMERAIL_ENV=local` かつ `.localhost` メインドメイン・`scpaiueouiuiuiui` サイトのみでページ変更を組み込み管理者として実行(`docs/local-authoring-boundary.md`)。

## 2. エントリポイント

- 公開: ページ閲覧、`/-/login`, `/-/register`, `/-/forgot`, `/-/reset`, `/-/verify-email`, フィード, sitemap, `ajax-module-connector.php`, `xml-rpc-api.php`, フォーラム。
- 認証済み: ページ編集/作成/移動/削除、ファイルアップロード、投票、メッセージ、サイト設定、`/-/admin`, `_admin`。
- ファイルドメイン: WWS(添付・テキストブロック `[[html]]`/`[[code]]`)。
- 内部: Deepwell `/jsonrpc`(トークン必須)、ジョブワーカー、インポーター、シーダー。
- 運用: Komodo(`deploy.wikijump.com`)。

## 3. 資産とデータの機密性

- ユーザー認証情報(パスワードハッシュ、MFA シークレット、リカバリーコード)、セッショントークン、メール/リセットトークン。
- プラットフォームスタッフ・サイト管理者権限、ロール/パーミッション。
- `DEEPWELL_RPC_TOKEN`、DB、S3 バケット、Redis。
- ページ内容と履歴の完全性(ミラー `scp-wiki` / `scp-jp` を含む)、非公開リビジョン・削除ページ。
- 永続ボリューム `wikijump-standing-*`。
**ユーザー回答: 最重要資産は (1) ユーザーの認証情報・セッション、(2) アップロードファイル・非公開データ。**

## 4. 攻撃者プロファイル

**ユーザー回答: ローカル(WSL/localhost)のみで運用し、インターネット公開の予定はない。アカウントを持つのは運営者本人のみ。**

- 未認証のインターネット利用者: 公開運用しないため対象外(ユーザー回答)。ただし運営者のブラウザ経由で到達する攻撃(悪意ある外部サイトからの CSRF/DNS リバインディング等で localhost に到達するもの)は残る。
- 公開サインアップで得た一般アカウント: アカウントは運営者のみのため対象外(ユーザー回答)。`/-/register` は存在するが利用者は運営者のみ。
- 悪意あるコンテンツ: 自分以外の作者はいないが、ミラー `scp-wiki` / `scp-jp` に Wikidot からインポートされた第三者作成の wikitext・ファイルは未信頼入力として残る(推定)。
- サイト管理者による他サイト/プラットフォームへの越権: アカウントが運営者のみのため実質対象外(ユーザー回答から導出)。
- 内部ネットワーク上の攻撃者(Deepwell トークン、内部ヘッダー偽装)。

## 5. 既存の対策

- Deepwell の RPC トークン(`rpc_auth.rs`、定数時間比較、単一 Authorization ヘッダー)。
- Deepwell 側ミューテーション認可とアクター一致検証(`deepwell/README.md`)。
- `#![forbid(unsafe_code)]`(Deepwell)。
- Caddy での `X-Wikijump-*` リクエストヘッダー除去。
- ファイルドメイン分離と親ドメイン Cookie のテスト(`framerail/tests/session-cookie-domain.test.ts`)。
- 互換アクションのスロットル(`docs/local-authoring-boundary.md`)。
- セキュリティヘッダー(`framerail/src/lib/server/security-headers.ts`)。

## 6. スコープ外・受容済みリスク

リポジトリの `docs/wikidot-compatibility-security.md`(ユーザー作成)より、Wikidot 互換のため意図的に再現している挙動:
- 新規タブリンクの `rel="noopener noreferrer"` 省略。
- `[[a href="javascript:..."]]` の Wikidot 流正規化(拒否しない)。
- `set-tags` ボタンハンドラーの生バックスラッシュ。
- `#expr` の 256 文字制限なし。
- 保存済み `[[html]]` 内の単一 iframe の直接出力(文書化された狭い条件のみ。条件外への拡大は対象)。
- pagepath `Create new` の非トランザクション的ページ作成。
**ユーザー回答: これらの互換挙動も通常どおり評価する(受容済みリスクとして優先度を下げない)。** 同ドキュメントは「一般公開のインターネットサービスではなくローカル運用」と記載。

**ユーザー回答: スキャン範囲は `deepwell/src`, `framerail/src`, `wws/src`, `install/prod`, `install/common` に限定。** `install/local/**` 等は対象外。

## 7. 優先度付けの方針

- インターネット上の未認証攻撃者、または運営者以外のアカウントを前提とする所見は優先度を下げる(ローカル運用・運営者のみ — ユーザー回答)。
- 運営者のブラウザ経由で localhost に到達できる経路(CSRF、DNS リバインディング、ファイルドメインからの Cookie 窃取)、ミラーの第三者コンテンツ経由の経路は据え置き。
- 認証情報・セッション、アップロードファイル・非公開データに到達する所見はスキャナー確認済みの経路に限り引き上げ候補。

## 8. 未解決の質問

- `install/prod` の本番構成は将来使う予定があるか(現状は公開予定なしとの回答)。
