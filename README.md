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