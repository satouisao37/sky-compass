# スカイコンパス

現在地から見た太陽・月の方位/高度・出没/薄明時刻・月齢を iPhone で確認する PWA(星景・夜景の撮影計画用)。vanilla JS・ビルド無し、GitHub Pages 配信。詳細仕様は末尾の `@import`(spec.md)で読み込む。リポジトリ: `satouisao37/sky-compass`。

> Issue 作成 → 実装 → 日本語コミット → close の**共通フロー・コミット規約・禁止事項は親 `/Users/soshi/dev/CLAUDE.md`「全ツール共通の作業フロー」に集約**。ここには再掲せず、このツール固有の前提とコマンドだけを書く。

## 最重要の前提(壊さないこと)

- **`astro.js` = 純粋計算 / `app.js` = 副作用(geolocation・センサー・SVG・SW)** の分離を保つ。`astro.js` は JXA から eval できるよう `module.exports` ガードを維持(テストが依存)。
- **リリース時は `index.html` フッターの `スカイコンパス vX.Y.Z` と `sw.js` の `CACHE_VERSION` を同時に bump**(機能追加=マイナー / バグ修正・改善=パッチ)。片方だけだとユーザー実機で更新が反映されない。
- 表示切替は **`classList` に統一**。SVG 要素に `hidden` プロパティは無く、HTMLElement の `[hidden]` も author CSS の `display` に負ける(サイレント無効)。
- 配信は GitHub Pages の**公開リポ**(iOS は非 HTTPS で GPS・コンパス不可。private 規約のユーザー承認済み例外)。**`git push` = そのままデプロイ**(main を Pages が ~1 分で自動配信)。
- センサー・GPS・地図の実挙動は **HTTPS + 実機でしか検証できない**(curl・ローカル http・headless は `webkitCompassHeading` 経路を通らない)。設計上の不変条件(3D姿勢・天球投影の手系・地図設定など)は spec.md §6 が正本。**触る前に §6 を読む**。

## 作業フロー(ツール固有)

- 天文ロジックは `astro.js` に純粋関数で足し、`test/astro.test.js`(USNO 参照値 `expected.json` と突合)を更新する。副作用は `app.js` に閉じ込める。
- コメント・UI 文言は**日本語**。
- 実装後に必ず実行(node 不要・JXA 構文チェック＋計算突合):

  ```bash
  bash test/run.sh
  ```

- UI のローカル確認は `python3 -m http.server`、実 UI 挙動は headless Chrome + CDP で検証(→ 固有 knowhow / spec.md §6 のリンク先)。センサー系は最終的に実機フィードバックで確定。

## Obsidian Vault 連携

### 仕様ノート(必読)
@/Users/soshi/dev/vault/Tools/sky-compass/spec.md

### ツール固有ノウハウフォルダ
過去のノウハウを参照したくなったら `Glob`/`Read`:
- `/Users/soshi/dev/vault/Tools/sky-compass/knowhow/`

(共通ノウハウ・ユーザー好み・キャプチャルール・作業フローは親 `/Users/soshi/dev/CLAUDE.md` で読み込み済み)
