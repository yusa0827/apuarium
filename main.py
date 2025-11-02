# main.py
import asyncio
import json
import math
import random
from typing import List, Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

app = FastAPI()

# 静的ファイル（index.html / app.js / goldfish.png）を配信
app.mount("/static", StaticFiles(directory="static"), name="static")

# ---- シミュレーション設定 ----
FISH_COUNT = 20
TICK_HZ = 20          # 送信レート（20Hz = 50ms)
SPEED_MIN = 0.05      # 規格化座標(0..1) / sec
SPEED_MAX = 0.15
TURN_NOISE = 0.7      # 向きのランダムゆらぎ（大きいほど曲がる）
WALL_BOUNCE = 0.9     # 壁反射の強さ(0..1)

# 規格化空間(0..1)でシミュレーション、クライアント側でCanvasサイズに合わせて描画
class Fish:
    def __init__(self, idx: int):
        self.id = idx
        self.x = random.random()
        self.y = random.random()
        self.dir = random.uniform(0, 2 * math.pi)  # 角度ラジアン
        self.speed = random.uniform(SPEED_MIN, SPEED_MAX)
        self.scale = random.uniform(0.8, 1.2)     # 見た目スケール（描画ヒント）
        self.flip = 1                              # 左右反転ヒント

    def step(self, dt: float):
        # 少しずつ向きをランダムに変更（ゆらぎ）
        self.dir += random.uniform(-TURN_NOISE, TURN_NOISE) * dt

        # 角度を正規化（-π ~ π）
        self.dir = math.atan2(math.sin(self.dir), math.cos(self.dir))

        # 速度ベクトル
        vx = math.cos(self.dir) * self.speed
        vy = math.sin(self.dir) * self.speed

        nx = self.x + vx * dt
        ny = self.y + vy * dt

        bounced = False
        new_dir = self.dir

        # 壁で反射（0..1内に留める）
        # コーナー反射のバグ修正：角度変更を一時変数で管理
        if nx < 0.02:
            nx = 0.02
            new_dir = math.pi - new_dir
            bounced = True
        elif nx > 0.98:
            nx = 0.98
            new_dir = math.pi - new_dir
            bounced = True

        if ny < 0.05:
            ny = 0.05
            new_dir = -new_dir
            bounced = True
        elif ny > 0.95:
            ny = 0.95
            new_dir = -new_dir
            bounced = True

        # 反射時の処理
        if bounced:
            self.dir = new_dir
            # 反射時に少し減衰
            self.speed = max(SPEED_MIN, self.speed * (0.9 + 0.1 * WALL_BOUNCE))
        else:
            # 通常時にランダムで微加速（速度減衰のみの問題を改善）
            if random.random() < 0.02:  # 2%の確率で加速
                self.speed = min(SPEED_MAX, self.speed * 1.05)

        # 左右の向きヒント（現在のdirから計算）
        # goldfish.pngは左向き: 左向き(vx<0)→そのまま(1)、右向き(vx>0)→反転(-1)
        current_vx = math.cos(self.dir) * self.speed
        self.flip = 1 if current_vx < 0 else -1

        self.x, self.y = nx, ny

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "x": self.x,
            "y": self.y,
            "dir": self.dir,
            "scale": self.scale,
            "flip": self.flip,
        }

class Tank:
    def __init__(self, fish_count: int):
        self.fish: List[Fish] = [Fish(i) for i in range(fish_count)]

    def step(self, dt: float):
        for f in self.fish:
            f.step(dt)

    def snapshot(self) -> Dict[str, Any]:
        return {"type": "state", "fish": [f.to_dict() for f in self.fish]}

tank = Tank(FISH_COUNT)

# ---- WebSocket ルーム管理 ----
class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, message: str):
        # 途中切断などを吸収
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

manager = ConnectionManager()

@app.get("/")
async def root():
    # static/index.html を既定画面に
    return HTMLResponse(open("static/index.html", "r", encoding="utf-8").read())

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        # 接続直後に初期スナップショットを返す
        await ws.send_text(json.dumps(tank.snapshot()))
        # クライアントからのメッセージ（将来：設定変更など）を受け取る準備
        while True:
            _ = await ws.receive_text()  # 今は特に使わない（ping/pong用途など）
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception:
        manager.disconnect(ws)

# ---- シミュレーションループ（バックグラウンドタスク） ----
async def simulation_loop():
    tick = 1.0 / TICK_HZ
    while True:
        tank.step(tick)
        if manager.active:
            await manager.broadcast(json.dumps(tank.snapshot()))
        await asyncio.sleep(tick)

@app.on_event("startup")
async def on_startup():
    # バックグラウンドでシミュレーション開始
    asyncio.create_task(simulation_loop())
