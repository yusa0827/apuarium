# コンセプト
魚がいるアクアリウムを鑑賞して、癒されること、楽しめること


# ディレクトリ構成
aquarium/
├─ main.py                # FastAPI + WebSocket（既存のWeb向け2D/3Dクライアント用）
├─ requirements.txt
├─ python_sim/            # Pythonのみで動く3D金魚モデルと水槽シミュレーション
│  ├─ __init__.py
│  ├─ __main__.py        # `python -m python_sim` でCLI起動
│  ├─ model.py           # 金魚メッシュの生成とOBJ書き出し
│  └─ simulation.py      # Matplotlibによる水槽内アニメーション
└─ static/
   ├─ index.html          # Webクライアント（Three.jsベース）
   └─ app.js              # Three.js シーンセットアップとWS受信


# 要件
LAN内自宅/社内サーバ: Windowsのファイアウォール例外、ブラウザからの接続のためホスト0.0.0.0で起動、社内DNS/固定IP/ポート解放を検討。　　
WebSocket: 1ルーム（全員同じ水槽）でOK。将来は部屋IDで多水槽に拡張可。　　
2D/ドット絵: サーバー側でPNGを配布します（ドット絵金魚）。クライアントCanvasにスケーリングして描画。　　
エフェクト（泡/水流）: あり。クライアントで軽量に生成（魚とは独立）。負荷低いです。　　
20匹: サーバーで20体の座標を20Hzで送信（十分滑らか、負荷軽い）。将来負荷に応じてチューニング。　　
“Pythonライブラリを使う”: WebサーバーはFastAPI/uvicorn/websockets。ローカルで3Dモデルを扱いたい場合は
`python_sim` パッケージを利用することで GPU を使わずに Python/NumPy/Matplotlib だけで金魚と水槽のアニメーションを
動かせます。
将来の追加: エサ・群泳（boids）・DB設定保存・HTTPS/TLS・認証は後で足せます。


# Pythonベースの3D金魚シミュレーション

GPU が無い環境でも動かせるよう、金魚メッシュを数百ポリゴンで構成し、Matplotlib の 3D 描画で水槽内を泳ぐ様子を
再現します。`python_sim` パッケージは以下の 2 つの用途で利用できます。

1. OBJ ファイルとして金魚メッシュをエクスポートする
2. Python 内で 3D 水槽アニメーションを再生する

## インストール

```
pip install -r requirements.txt
```

## OBJ ファイルを書き出す

```
python -m python_sim --export goldfish.obj
```

出力された `goldfish.obj` は頂点カラーを含んでいるので、DCC ツールに取り込んで質感調整に活用できます。

## 水槽アニメーションを再生する

```
python -m python_sim --fish 5 --seconds 60 --fps 24
```

Matplotlib のウィンドウが開き、金魚が水槽内をゆっくり泳ぎます。`--seed` を指定すると同じ動きを再現できます。


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