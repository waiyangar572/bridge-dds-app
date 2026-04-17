# 指示

あなたは、テクニカルSEOに極めて精通した凄腕のフロントエンドエンジニアです。
現在Firebase Hosting (`.web.app`) で稼働しているコントラクトブリッジ分析SPA（Single Page Application）に対して、オーガニックトラフィックを最大化するための高度なSEO改修を行ってください。

# 背景と目標

- サイトには優れた「Double Dummy Solver」「Single Dummy Solver」などのツールがありますが、現状はSPAの特性上、Googleクローラーにコンテンツが正しくインデックスされにくい状態です。
- ターゲットとする検索キーワードは「double dummy solver online」「contract bridge hand analyzer」「bridge opening lead calculator」などのグローバルなロングテールキーワードです。
- 検索エンジンに「これは価値のあるWebアプリケーションである」と正確に認識させることが目標です。

# 厳守事項（制約）

- **現在の洗練されたユーザー体験（UX）、UIデザイン、ツールの動作スピードは一切損なわないこと。**
- すべての改修は、バックグラウンド（`<head>`内や不可視領域）、またはインフラ（ビルド設定）のレベルで行うこと。

# 実装要求事項

## 1. 動的メタデータの最適化 (React Helmet等の活用)

各ページ（トップ、DDS、SDS、Lead Analyzer、記事ページ）ごとに、以下のタグが動的に適切に設定されるよう実装してください。

- `<title>` (キーワードを含めた魅力的なタイトル。例: "Double Dummy Solver - Bridge Analyzer")
- `<meta name="description">` (各ツールの機能を具体的に説明する120文字程度のテキスト)
- `<link rel="canonical" href="...">` (URLの正規化による評価分散の防止)

## 2. OGP (Open Graph Protocol) と Twitter Cards の設定

SNSでのシェア時にクリック率を最大化するため、全ページに共通（またはページ固有）のOGPタグとTwitter Cardタグを設定してください。

- `og:title`, `og:description`, `og:type` (トップはwebsite, 記事はarticle), `og:url`
- `twitter:card` (summary_large_image)

## 3. JSON-LD (構造化データ) の導入

Googleの検索結果にリッチリザルト（特別な枠）として表示される確率を上げるため、サイトトップまたは各ツールページに `SoftwareApplication` または `WebApplication` のJSON-LD構造化データを追加するコンポーネントを作成してください。

- `name`, `applicationCategory` (GameApplication / SportsActivityLocation等適切なもの), `operatingSystem`, `offers` (Free) などの属性を含めること。

## 4. クローラビリティの向上 (sitemap.xml / robots.txt)

- 検索エンジンがサイト内の全ページを迷わず巡回できるよう、`sitemap.xml` と `robots.txt` を自動生成、または静的に配置する設定を行ってください。

## 5. SPAのインデックス問題への対応策（提案と実装）

Firebase Hostingで稼働するSPAにおいて、クローラーに初期HTMLを正しく解釈させるための最適なアプローチ（以下のいずれか）を提案し、その設定ファイルやコードを提示してください。

- A: SSR (Server-Side Rendering) や SSG (Static Site Generation) への移行（Next.js等を使用している場合）
- B: Vite等のビルドツールを使ったプレレンダリング（Prerendering）プラグインの導入

# 出力形式

1. まず、JSON-LDの構造と、設定すべきメタデータ（Title/Description）の構成案（英語）を提示してください。
2. 次に、動的メタデータとJSON-LDを挿入するためのReactコンポーネント（例: `SeoHead.jsx`）のコードを出力してください。
3. 最後に、sitemap.xmlの生成方法と、SPAのインデックス問題を解決するための具体的なビルド設定（Vite設定ファイルなど）を出力してください。
