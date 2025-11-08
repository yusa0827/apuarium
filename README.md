# Apuarium – 3D 金魚の Web 水槽

Three.js と FastAPI を使って、プロシージャルに生成した 3D 金魚モデルを Web ブラウザ上で泳がせるデモです。サーバーは WebSocket で金魚の隊列データを配信し、クライアントは glTF 形式の金魚モデルを複製して水槽内を遊泳させます。

## 主な特徴
- **プロシージャルな 3D 金魚モデル** – `tools/generate_goldfish_gltf.py` が glTF (JSON) を生成し、Three.js が直接読み込みます。ふっくらしたボディと二股に広がるファンテール、パステルカラーのグラデーションを備えた新しいキュートな造形をスクリプトだけで表現しています。
- **WebGL ベースの疑似水槽** – 水槽の壁、ボリュームフォグ、ライトをセットアップし、奥行き感のある環境で金魚を描画します。
- **リアルタイムな群泳制御** – FastAPI で動作するシミュレーションが 20Hz で魚の位置と向きを配信し、未接続時はクライアント側でフォールバック群泳を生成します。
- **GPU 不要の軽量設計** – モデルは 10k 未満のポリゴンで構成され、ブラウザだけでアニメーションが完結します。

## ディレクトリ構成
```
apuarium/
├─ main.py                  # FastAPI + WebSocket サーバー
├─ requirements.txt         # 必要な Python 依存
├─ static/
│  ├─ index.html            # Three.js を読み込むトップページ
│  ├─ app.js                # WebGL 水槽と金魚ロジック（ES Module）
│  └─ models/
│     └─ goldfish.gltf      # プロシージャル生成済み 3D モデル
└─ tools/
   └─ generate_goldfish_gltf.py  # glTF 再生成用スクリプト
```

## セットアップと起動
1. 依存パッケージをインストールします。
   ```bash
   pip install -r requirements.txt
   ```
2. 開発サーバーを起動します。
   ```bash
   python -m uvicorn main:app --host 0.0.0.0 --port 8000
   ```
3. ブラウザで `http://localhost:8000` を開くと、3D 水槽が表示されます。LAN 内の別デバイスからアクセスする場合は、サーバーのローカル IP アドレスを利用してください。

## 3D 金魚モデルの再生成
`static/models/goldfish.gltf` は `tools/generate_goldfish_gltf.py` によりプロシージャルに生成されています。丸い頬やファンテール、瞳のサイズ、パステル調の頂点カラーまで Python スクリプト内で定義しているため、数値を調整するだけで好みの“かわいい”スタイルに作り直せます。
```bash
python tools/generate_goldfish_gltf.py
```

## WebSocket データ仕様
サーバー (`main.py`) は以下の JSON を 20Hz で送信します。
```json
{
  "type": "state",
  "fish": [
    {
      "id": 0,
      "x": 0.42,
      "y": 0.58,
      "z": 0.66,
      "scale": 1.05,
      "vx": 0.03,
      "vy": -0.01,
      "vz": 0.02,
      "speed": 0.04,
      "heading": {"x": 0.62, "y": -0.21, "z": 0.75}
    },
    ...
  ]
}
```
- `x`, `y`, `z`: 規格化座標 (0〜1)。クライアント側で 3D 水槽空間にマッピングします。
- `scale`: 見た目サイズのヒント。個体差を付ける用途です。
- `vx`, `vy`, `vz`: 単位空間あたりの速度ベクトル。姿勢補間やアニメーション速度に利用します。
- `speed`: ベクトル長（移動スピード）。
- `heading`: 正規化済みの進行方向ベクトル。速度が極端に小さい際の代替になります。
- `dir`, `flip`: 後方互換のために残している 2D 向き情報。新フロントエンドでは補助的に参照されます。

クライアントは WebSocket 未接続または空配信時でも、フォールバックの 3D 群泳を生成して水槽を維持します。

## Git 作業のヒント
- 作業前に `git pull --rebase` を実行して最新状態を取り込むと、プッシュ時のコンフリクトを防ぎやすくなります。
- 詳細な手順は [`docs/git-pull-guide.md`](docs/git-pull-guide.md) にまとめています。リモートの確認からコンフリクト解消まで手順を追って解説しています。

## 参考ドキュメント
- [`docs/git-remote-guide.md`](docs/git-remote-guide.md) – リモートリポジトリの確認と追加方法。
- [`docs/git-apply-guide.md`](docs/git-apply-guide.md) – `git apply` で差分を取り込むワークフロー。
- [`docs/browser-3d-overview.md`](docs/browser-3d-overview.md) – ブラウザで 3D 表現を行うための代表的なアプローチの比較ガイド。

## ライセンス
プロジェクト内のコードおよび生成されたモデルは MIT License で提供します。商用利用や改変も自由に行えますが、再配布時はライセンス表記を残してください。
