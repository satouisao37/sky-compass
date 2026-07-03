# スカイコンパス

現在地から見た太陽と月の方位、高度、出没時刻を確認する iPhone 向け PWA です。外部依存なしで GitHub Pages のサブパス配信に対応します。

## 使い方

`index.html` をブラウザで開くか、GitHub Pages に配置します。初回は東京駅の座標で描画し、位置情報が許可されると現在地で更新します。圏外の撮影地では設定から緯度経度を手入力できます。

## 開発

アイコン生成:

```sh
python3 tools/gen_icons.py
```

テスト:

```sh
bash test/run.sh
```

テストは JXA (`osascript -l JavaScript`) で `astro.js` を読み込み、参照値との時刻差と物理アンカーを確認します。
