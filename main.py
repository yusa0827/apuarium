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

# 静的ファイル（index.html / app.js など）を配信
app.mount("/static", StaticFiles(directory="static"), name="static")

# ---- シミュレーション設定 ----
FISH_COUNT = 18
TICK_HZ = 20          # 送信レート（20Hz = 50ms)
SPEED_MIN = 0.05      # 規格化座標(0..1) / sec
SPEED_MAX = 0.16
TURN_NOISE = 1.2      # 向きのランダムゆらぎ（大きいほど曲がる）
WALL_BOUNCE = 0.85    # 壁反射の強さ(0..1)

# 規格化空間(0..1)でシミュレーション、クライアント側でCanvasサイズに合わせて描画
def _random_direction() -> List[float]:
    azimuth = random.uniform(0, 2 * math.pi)
    elevation = random.uniform(-math.pi / 6, math.pi / 6)
    cos_elev = math.cos(elevation)
    return [
        cos_elev * math.cos(azimuth),
        math.sin(elevation),
        cos_elev * math.sin(azimuth),
    ]


def _normalize(vec: List[float]) -> List[float]:
    length = math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2)
    if length < 1e-6:
        return [1.0, 0.0, 0.0]
    return [vec[0] / length, vec[1] / length, vec[2] / length]


class Fish:
    def __init__(self, idx: int):
        self.id = idx
        self.pos = [random.random(), random.random(), random.random()]
        self.dir = _normalize(_random_direction())
        self.speed = random.uniform(SPEED_MIN, SPEED_MAX)
        self.scale = random.uniform(0.75, 1.25)
        self.flip = 1
        self.velocity = [self.dir[i] * self.speed for i in range(3)]

    def _bounce_axis(self, axis: int, limit_low: float, limit_high: float) -> None:
        if self.pos[axis] < limit_low:
            self.pos[axis] = limit_low
            self.dir[axis] = abs(self.dir[axis])
            self.velocity[axis] = abs(self.velocity[axis])
            self.speed = max(SPEED_MIN, self.speed * WALL_BOUNCE)
        elif self.pos[axis] > limit_high:
            self.pos[axis] = limit_high
            self.dir[axis] = -abs(self.dir[axis])
            self.velocity[axis] = -abs(self.velocity[axis])
            self.speed = max(SPEED_MIN, self.speed * WALL_BOUNCE)

    def step(self, dt: float):
        # ランダムな揺らぎで方向ベクトルを変化させる
        jitter = [
            random.uniform(-TURN_NOISE, TURN_NOISE) * dt,
            random.uniform(-TURN_NOISE, TURN_NOISE) * dt * 0.6,
            random.uniform(-TURN_NOISE, TURN_NOISE) * dt,
        ]
        self.dir = _normalize([
            self.dir[0] + jitter[0],
            self.dir[1] + jitter[1],
            self.dir[2] + jitter[2],
        ])

        # ゆるやかな中心回帰で群れのまとまりを保つ
        center_pull = [(0.5 - self.pos[i]) * 0.15 * dt for i in range(3)]
        self.dir = _normalize([
            self.dir[0] + center_pull[0],
            self.dir[1] + center_pull[1],
            self.dir[2] + center_pull[2],
        ])

        # 速度ベクトルを更新
        self.velocity = [self.dir[i] * self.speed for i in range(3)]

        # 位置を更新
        for i in range(3):
            self.pos[i] += self.velocity[i] * dt

        # 境界反射（わずかなマージンを取る）
        self._bounce_axis(0, 0.05, 0.95)
        self._bounce_axis(1, 0.05, 0.95)
        self._bounce_axis(2, 0.08, 0.92)
        self.dir = _normalize(self.dir)
        self.velocity = [self.dir[i] * self.speed for i in range(3)]

        # 速度の自然な変化
        if random.random() < 0.05:
            self.speed = min(SPEED_MAX, self.speed * 1.05)
        elif random.random() < 0.05:
            self.speed = max(SPEED_MIN, self.speed * 0.97)

        # 左右反転ヒント
        self.flip = -1 if self.velocity[0] < 0 else 1

    def to_dict(self) -> Dict[str, Any]:
        heading = _normalize(self.velocity)
        return {
            "id": self.id,
            "x": self.pos[0],
            "y": self.pos[1],
            "z": self.pos[2],
            "dir": math.atan2(self.velocity[1], self.velocity[0]),
            "scale": self.scale,
            "flip": self.flip,
            "vx": self.velocity[0],
            "vy": self.velocity[1],
            "vz": self.velocity[2],
            "speed": self.speed,
            "heading": {"x": heading[0], "y": heading[1], "z": heading[2]},
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
