"""金魚メッシュを用いた簡易 3D 水槽シミュレーション。"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Iterable, List, Tuple

import numpy as np
from matplotlib import pyplot as plt
from matplotlib.animation import FuncAnimation
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

from .model import GoldfishModel


@dataclass
class FishState:
    position: np.ndarray  # shape (3,)
    velocity: np.ndarray  # shape (3,)
    yaw: float
    pitch: float
    roll: float
    swim_phase: float
    scale: float


class AquariumSimulation:
    """金魚を複数体配置して Matplotlib で描画・アニメーションする。"""

    def __init__(
        self,
        tank_size: Tuple[float, float, float] = (2.5, 1.2, 1.4),
        fish_count: int = 4,
        seed: int | None = None,
    ) -> None:
        if seed is not None:
            random.seed(seed)
            np.random.seed(seed)

        self.tank_size = np.array(tank_size, dtype=np.float32)
        self.model = GoldfishModel()
        self.mesh = self.model.build()
        self.fish: List[FishState] = []
        self.time = 0.0
        self._init_school(fish_count)

    # ------------------------------------------------------------------
    def _init_school(self, fish_count: int) -> None:
        for _ in range(fish_count):
            position = (np.random.rand(3) - 0.5) * self.tank_size * np.array([1.0, 0.8, 0.8])
            velocity = (np.random.rand(3) - 0.5) * np.array([0.3, 0.18, 0.24])
            yaw = math.atan2(velocity[2], velocity[0])
            pitch = -math.atan2(velocity[1], max(1e-5, np.linalg.norm(velocity[[0, 2]])))
            state = FishState(
                position=position,
                velocity=velocity,
                yaw=yaw,
                pitch=pitch,
                roll=0.0,
                swim_phase=random.random() * math.tau,
                scale=0.65 + random.random() * 0.4,
            )
            self.fish.append(state)

    # ------------------------------------------------------------------
    def step(self, dt: float = 1 / 24) -> None:
        bounds = self.tank_size / 2
        for fish in self.fish:
            desired = self._wander_force(fish)
            fish.velocity += desired * dt
            speed = np.linalg.norm(fish.velocity)
            speed = np.clip(speed, 0.05, 0.35)
            fish.velocity = (fish.velocity / (speed + 1e-6)) * speed

            fish.position += fish.velocity * dt

            for axis in range(3):
                limit = bounds[axis]
                if fish.position[axis] > limit:
                    fish.position[axis] = limit
                    fish.velocity[axis] *= -0.85
                elif fish.position[axis] < -limit:
                    fish.position[axis] = -limit
                    fish.velocity[axis] *= -0.85

            fish.yaw = math.atan2(fish.velocity[2], fish.velocity[0])
            fish.pitch = -math.atan2(
                fish.velocity[1], max(1e-5, np.linalg.norm(fish.velocity[[0, 2]]))
            )
            fish.roll = math.sin(self.time * 0.6 + fish.swim_phase) * 0.1
            fish.swim_phase = (fish.swim_phase + dt * 4.0) % math.tau

        self.time += dt

    # ------------------------------------------------------------------
    def _wander_force(self, fish: FishState) -> np.ndarray:
        # ノイズベクトル
        jitter = (np.random.rand(3) - 0.5) * np.array([0.12, 0.08, 0.1])
        # 領域中心へ戻す力
        center_force = -fish.position * 0.3
        # 高さ方向はゆっくり揺らす
        vertical = math.sin(self.time * 0.3 + fish.swim_phase) * 0.06 - fish.position[1] * 0.12
        return center_force + jitter + np.array([0.0, vertical, 0.0])

    # ------------------------------------------------------------------
    def transformed_meshes(self) -> Iterable[Tuple[np.ndarray, np.ndarray]]:
        base = self.mesh.vertices
        for fish in self.fish:
            rot = _rotation_matrix(fish.yaw, fish.pitch, fish.roll)
            scaled = base * fish.scale
            deformed = scaled.copy()

            # 尾びれを左右に振る簡易アニメーション
            tail_mask = base[:, 0] > self.model.body_length * 0.2
            tail_offset = np.sin(self.time * 3.2 + fish.swim_phase) * 0.15
            deformed[tail_mask, 2] += (base[tail_mask, 0] - self.model.body_length * 0.2) * tail_offset

            # 胸びれの開閉
            fin_mask = (base[:, 0] < -self.model.body_length * 0.1) & (np.abs(base[:, 2]) > self.model.body_radius * 0.5)
            fin_wave = np.sin(self.time * 5.0 + fish.swim_phase)
            deformed[fin_mask, 1] += 0.08 * fin_wave * np.sign(base[fin_mask, 1])

            rotated = deformed @ rot.T
            translated = rotated + fish.position
            yield translated, self.mesh.faces

    # ------------------------------------------------------------------
    def run(self, seconds: float = 30.0, fps: int = 24) -> None:
        fig = plt.figure(figsize=(8, 5))
        ax = fig.add_subplot(111, projection="3d")
        ax.set_xlim(-self.tank_size[0] / 2, self.tank_size[0] / 2)
        ax.set_ylim(-self.tank_size[1] / 2, self.tank_size[1] / 2)
        ax.set_zlim(-self.tank_size[2] / 2, self.tank_size[2] / 2)
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_zticks([])
        ax.set_box_aspect(self.tank_size)
        ax.set_facecolor("#0b1d2a")
        fig.tight_layout()

        mesh_collections: List[Poly3DCollection] = []

        def init_plot() -> List[Poly3DCollection]:
            while mesh_collections:
                mesh_collections.pop().remove()
            for verts, faces in self.transformed_meshes():
                tris = [verts[face] for face in faces]
                poly = Poly3DCollection(tris, linewidths=0.1, alpha=0.92)
                poly.set_facecolor((1.0, 0.58, 0.4, 0.92))
                poly.set_edgecolor((0.1, 0.1, 0.1, 0.3))
                mesh_collections.append(poly)
                ax.add_collection3d(poly)
            return mesh_collections

        def update(_frame: int) -> List[Poly3DCollection]:
            self.step(1.0 / fps)
            while mesh_collections:
                mesh_collections.pop().remove()
            for verts, faces in self.transformed_meshes():
                tris = [verts[face] for face in faces]
                poly = Poly3DCollection(tris, linewidths=0.1, alpha=0.92)
                poly.set_facecolor((1.0, 0.58, 0.4, 0.92))
                poly.set_edgecolor((0.1, 0.1, 0.1, 0.3))
                mesh_collections.append(poly)
                ax.add_collection3d(poly)
            return mesh_collections

        frame_total = int(seconds * fps)
        anim = FuncAnimation(
            fig,
            update,
            init_func=init_plot,
            frames=frame_total,
            interval=1000 / fps,
            blit=False,
        )
        plt.show()
        return anim

    # ------------------------------------------------------------------
    def export_obj(self, destination: str) -> None:
        self.model.export_obj(destination)


def _rotation_matrix(yaw: float, pitch: float, roll: float) -> np.ndarray:
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    cr, sr = math.cos(roll), math.sin(roll)

    rot_yaw = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rot_pitch = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    rot_roll = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    return rot_yaw @ rot_pitch @ rot_roll
