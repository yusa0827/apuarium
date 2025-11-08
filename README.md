# コンセプト
魚がいるアクアリウムを鑑賞して、癒されること、楽しめること


# ディレクトリ構成
aquarium/
├─ main.py                # FastAPI + WebSocket（サーバー側シミュレーション）
├─ requirements.txt
└─ static/
   ├─ index.html          # 画面（Canvas）
   ├─ app.js              # 最小JS：描画＆WS受信、泡エフェクト
   └─ goldfish.png        # ドット絵金魚（サンプル）


# 要件
LAN内自宅/社内サーバ: Windowsのファイアウォール例外、ブラウザからの接続のためホスト0.0.0.0で起動、社内DNS/固定IP/ポート解放を検討。　　
WebSocket: 1ルーム（全員同じ水槽）でOK。将来は部屋IDで多水槽に拡張可。　　
2D/ドット絵: サーバー側でPNGを配布します（ドット絵金魚）。クライアントCanvasにスケーリングして描画。　　
エフェクト（泡/水流）: あり。クライアントで軽量に生成（魚とは独立）。負荷低いです。　　
20匹: サーバーで20体の座標を20Hzで送信（十分滑らか、負荷軽い）。将来負荷に応じてチューニング。　　
“Pythonライブラリを使う”: サーバーはFastAPI/uvicorn/websockets（標準相当）。描画はブラウザでCanvas（JS最小限）。　　
もし「完全Python描画→画像を配信」だと激重（フレーム画像配信）になるので非推奨。　　
将来の追加: エサ・群泳（boids）・DB設定保存・HTTPS/TLS・認証は後で足せます。　　


# 起動
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000

# アクセス方法
サーバー起動後、ブラウザから以下のURLでアクセスできます：

## 同じPCからアクセスする場合
http://localhost:8000
または
http://127.0.0.1:8000

## LAN内の他のデバイスからアクセスする場合
サーバーのローカルIPアドレスを確認して、そのIPアドレス:8000でアクセスします。

### Windowsの場合（IPアドレス確認）
ipconfig
→ 「IPv4 アドレス」を確認（例：192.168.1.100）
→ ブラウザから http://192.168.1.100:8000 でアクセス

### macOS/Linuxの場合（IPアドレス確認）
ip addr show
または
ifconfig
→ inet の値を確認（例：192.168.1.100）
→ ブラウザから http://192.168.1.100:8000 でアクセス

※ 0.0.0.0 はサーバー側の設定で、クライアントからアクセスするアドレスではありません。
## Pythonベースの3D金魚シミュレーション
GPU がない環境でも 3D 金魚を扱えるよう、完全に Python で動作するプロシージャルモデリングと描画パイプラインを追加しました。

1. 依存パッケージをインストールします。
   ```bash
   pip install -r requirements.txt
   ```
2. プロシージャルに生成した金魚メッシュを OBJ として書き出したい場合は以下を実行します。
   ```bash
   python scripts/export_goldfish.py  # assets/goldfish.obj が生成されます
   ```
3. CPU レンダラで水槽シミュレーションを再生・保存するには次を実行します。
   ```bash
   python scripts/run_aquarium.py --fish 8 --seconds 45 --fps 20
   ```
   `--save` にファイルパス（例: `--save out.mp4`）を指定すると、Matplotlib のアニメーションとして保存できます。

`aquarium3d/` パッケージには以下のモジュールが含まれます。

- `goldfish.py`: 金魚のボディ・ヒレをスイープ生成し、OBJ に書き出せる三角メッシュを返します。
- `simulation.py`: 単純な群泳アルゴリズムで水槽内を遊泳させる CPU シミュレーションを提供します。
- `renderer.py`: Matplotlib で水槽・水面・金魚メッシュを描画し、アニメーション出力にも対応します。

既存の FastAPI + WebSocket サーバーは `main.py` に残しているため、ブラウザ向け 2D 表示が必要な場合も従来どおり利用できます。
