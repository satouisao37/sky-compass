# そらコンパス

## 作業フロー（必ず守ること）

### ステップ 1 — GitHub Issue を作成する

改善案・バグ修正・機能追加を受け取ったら、**必ず Issue を作成してから**作業を開始する。

```bash
gh issue create \
  --repo satouisao37/sky-compass \
  --title "【日本語で簡潔に】" \
  --body "$(cat <<'EOF'
## 概要
何を・なぜ変えるか

## 現状の問題
（あれば記載）

## 改善方針
具体的な実装アプローチ

## 変更対象ファイル
- 

## 備考
（あれば記載）
EOF
)"
```

Issue の本文に含めること:

- **概要**: 何を・なぜ変えるか
- **現状の問題**（あれば）
- **改善方針**: 具体的な実装アプローチ
- **変更対象ファイル**

---

### ステップ 2 — 実装する

- 既存ファイルを優先的に編集し、不要な新規ファイルは作らない
- 実装後は必ず構文チェックを行う

**Python の場合:**

```bash
python -c "import ast; ast.parse(open('対象ファイル.py', encoding='utf-8').read()); print('OK')"
```

**TypeScript / JavaScript の場合:**

```bash
npx tsc --noEmit --skipLibCheck
```

**その他の言語は適宜チェックコマンドを追加すること。**

---

### ステップ 3 — コミットしてプッシュする

**push 前のバージョン更新（ユーザーが実機で反映確認に使う）:**
ユーザーに見える挙動が変わる変更では、`index.html` フッターの `そらコンパス vX.Y.Z` を上げる（機能追加=マイナー、バグ修正・改善=パッチ）。`sw.js` の `CACHE_VERSION` も同時に bump する。

コミットメッセージは**日本語**で書く。

```bash
git add <変更ファイル>
git commit -m "$(cat <<'EOF'
【変更の種類】変更内容を日本語で簡潔に（#Issue番号）

- 箇条書きで変更の詳細を記述

Closes #Issue番号

Co-Authored-By: Claude <現在のモデル> <noreply@anthropic.com>
EOF
)"
git push
```

> **`Co-Authored-By` のモデル名は固定しない。** コミットを書く時点で **あなた(Claude)が実際に動作しているモデル名**に置き換える(例: `Claude Opus 4.8`)。モデル名はセッション開始時の環境情報で渡されている。

コミットメッセージのプレフィックス:

| プレフィックス | 用途 |
| --- | --- |
| `機能追加:` | 新機能の追加 |
| `改善:` | 既存機能の改善 |
| `バグ修正:` | 不具合の修正 |
| `リファクタリング:` | 動作変更なしのコード整理 |
| `設定:` | 設定・環境ファイルの変更 |
| `ドキュメント:` | README・コメント等の更新 |
| `テスト:` | テストの追加・修正 |

---

### ステップ 4 — Issue をクローズする

push 後に Issue を closed にする。

```bash
gh issue close <Issue番号> \
  --repo satouisao37/sky-compass \
  --comment "実装完了。コミット: $(git rev-parse --short HEAD)"
```

---

## コーディング規約

- コメントは**日本語**で記載する
- 既存のコードスタイル・命名規則に合わせる
- 1つのコミットに複数の無関係な変更を混ぜない

---

## 禁止事項

- `git push --force`
- 構文チェックなしでのコミット
- Issue を作成せずに作業を開始すること

---

## Obsidian Vault 連携

### 仕様ノート(必読)
@/Users/soshi/dev/vault/Tools/sky-compass/spec.md

### ツール固有ノウハウフォルダ
作業中に過去のノウハウを参照したくなったら `Glob`/`Read`:
- `/Users/soshi/dev/vault/Tools/sky-compass/knowhow/`

(共通ノウハウ・ユーザー好み・キャプチャルールは親 `/Users/soshi/dev/CLAUDE.md` で既に読み込み済み)
