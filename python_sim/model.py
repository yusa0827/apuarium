"""3D金魚メッシュの生成ユーティリティ。

GPU を前提とせず Python のみで扱えるよう、シンプルな三角形メッシュを
numpy で生成する。OBJ 形式への書き出し機能も併せて提供する。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Tuple

import numpy as np


@dataclass
class Mesh:
    """単純な三角形メッシュ。"""

    vertices: np.ndarray  # shape: (N, 3)
    faces: np.ndarray  # shape: (M, 3)
    vertex_colors: np.ndarray  # shape: (N, 3) range 0..1


class GoldfishModel:
    """金魚のメッシュを生成する。"""

    def __init__(
        self,
        body_length: float = 1.0,
        body_radius: float = 0.22,
        tail_length: float = 0.55,
        segments: int = 28,
        radial_slices: int = 24,
    ) -> None:
        self.body_length = body_length
        self.body_radius = body_radius
        self.tail_length = tail_length
        self.segments = segments
        self.radial_slices = radial_slices
        self._mesh: Mesh | None = None

    # ------------------------------------------------------------------
    # メッシュ生成
    def build(self) -> Mesh:
        if self._mesh is not None:
            return self._mesh

        body_vertices, body_faces, body_colors = self._build_body()
        tail_vertices, tail_faces, tail_colors = self._build_tail(len(body_vertices))
        fin_vertices, fin_faces, fin_colors = self._build_fins(
            len(body_vertices) + len(tail_vertices)
        )

        vertices = np.vstack([body_vertices, tail_vertices, fin_vertices])
        faces = np.vstack([body_faces, tail_faces, fin_faces])
        colors = np.vstack([body_colors, tail_colors, fin_colors])

        self._mesh = Mesh(vertices=vertices, faces=faces, vertex_colors=colors)
        return self._mesh

    # ------------------------------------------------------------------
    def _build_body(self) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        # 体の中心を x=0 とし、前方向に正の x を取る
        xs = np.linspace(-self.body_length * 0.65, self.body_length * 0.35, self.segments)
        thetas = np.linspace(0, 2 * np.pi, self.radial_slices, endpoint=False)

        verts = []
        colors = []
        for x in xs:
            # 胴体の半径分布（正規分布でふっくらさせる）
            sigma = self.body_length * 0.35
            radius = self.body_radius * np.exp(-((x + self.body_length * 0.15) ** 2) / (2 * sigma**2))
            # 尾側は徐々に細く
            if x > self.body_length * 0.05:
                taper = 1.0 - (x - self.body_length * 0.05) / (self.body_length * 0.45)
                radius *= max(0.15, taper)

            hue = 0.04 + 0.05 * np.clip((x + self.body_length * 0.2) / self.body_length, 0, 1)
            saturation = 0.75
            value = 0.85 + 0.1 * np.clip(radius / self.body_radius, 0, 1)
            color = np.array(_hsv_to_rgb(hue, saturation, value))

            for theta in thetas:
                y = np.cos(theta) * radius
                z = np.sin(theta) * radius
                verts.append([x, y, z])
                colors.append(color)

        verts = np.asarray(verts, dtype=np.float32)
        colors = np.asarray(colors, dtype=np.float32)

        faces = []
        ring = self.radial_slices
        for i in range(self.segments - 1):
            for j in range(ring):
                a = i * ring + j
                b = i * ring + (j + 1) % ring
                c = (i + 1) * ring + j
                d = (i + 1) * ring + (j + 1) % ring
                faces.append([a, c, b])
                faces.append([b, c, d])

        faces = np.asarray(faces, dtype=np.int32)
        return verts, faces, colors

    def _build_tail(self, offset: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        slices = 8
        span = self.tail_length
        heights = np.linspace(0.0, 0.35, slices)
        verts = []
        colors = []
        for i, h in enumerate(heights):
            sway = np.sin(i / (slices - 1) * np.pi) * 0.08
            verts.extend(
                [
                    [self.body_length * 0.35 + (i / (slices - 1)) * span, h, sway],
                    [self.body_length * 0.35 + (i / (slices - 1)) * span, -h, -sway],
                ]
            )
            shade = 0.8 - 0.2 * (i / (slices - 1))
            colors.extend([[1.0, 0.65, 0.4 * shade], [1.0, 0.6, 0.45 * shade]])

        verts = np.asarray(verts, dtype=np.float32)
        faces = []
        for i in range(0, len(verts) - 2, 2):
            faces.append([offset + i, offset + i + 1, offset + i + 2])
            faces.append([offset + i + 1, offset + i + 3, offset + i + 2])

        faces = np.asarray(faces, dtype=np.int32)
        colors = np.asarray(colors, dtype=np.float32)
        return verts, faces, colors

    def _build_fins(self, offset: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        verts = []
        colors = []
        faces = []

        def add_fin(anchor: Tuple[float, float, float],
                    points: Tuple[Tuple[float, float, float], ...],
                    tint: Tuple[float, float, float]) -> None:
            nonlocal offset
            base_index = offset + len(verts)
            verts.append(anchor)
            colors.append(tint)
            for p in points:
                verts.append(p)
                colors.append(tint)
            for i in range(1, len(points)):
                faces.append([base_index, base_index + i, base_index + i + 1])

        dorsal_tint = (0.95, 0.72, 0.62)
        dorsal_base = (self.body_length * -0.1, 0.0, 0.0)
        dorsal_pts = (
            (dorsal_base[0] + 0.05, 0.25, 0.0),
            (dorsal_base[0] + 0.18, 0.18, 0.05),
            (dorsal_base[0] + 0.26, 0.15, -0.04),
        )
        add_fin(dorsal_base, dorsal_pts, dorsal_tint)

        anal_tint = (0.98, 0.68, 0.55)
        anal_base = (self.body_length * 0.05, -0.05, 0.0)
        anal_pts = (
            (anal_base[0] + 0.1, -0.25, 0.02),
            (anal_base[0] + 0.2, -0.22, -0.03),
        )
        add_fin(anal_base, anal_pts, anal_tint)

        pectoral_tint = (1.0, 0.7, 0.55)
        for side in (-1, 1):
            base = (self.body_length * -0.15, 0.0, side * (self.body_radius * 0.6))
            pts = (
                (base[0] + 0.05, 0.05, side * (self.body_radius + 0.15)),
                (base[0] + 0.02, -0.08, side * (self.body_radius + 0.1)),
            )
            add_fin(base, pts, pectoral_tint)

        verts = np.asarray(verts, dtype=np.float32)
        colors = np.asarray(colors, dtype=np.float32)
        faces = np.asarray(faces, dtype=np.int32)
        return verts, faces, colors

    # ------------------------------------------------------------------
    def export_obj(self, destination: str | Path, color_tag: str = "vc") -> None:
        mesh = self.build()
        path = Path(destination)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as fh:
            fh.write("# Goldfish mesh generated by GoldfishModel\n")
            for v, c in zip(mesh.vertices, mesh.vertex_colors):
                fh.write(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f} {c[0]:.4f} {c[1]:.4f} {c[2]:.4f}\n")
            for face in mesh.faces:
                a, b, c = face + 1
                fh.write(f"f {a} {b} {c}\n")

    def summary(self) -> Dict[str, int]:
        mesh = self.build()
        return {
            "vertices": int(mesh.vertices.shape[0]),
            "faces": int(mesh.faces.shape[0]),
        }


def _hsv_to_rgb(h: float, s: float, v: float) -> Tuple[float, float, float]:
    h = h % 1.0
    i = int(h * 6)
    f = h * 6 - i
    p = v * (1 - s)
    q = v * (1 - f * s)
    t = v * (1 - (1 - f) * s)
    i = i % 6
    if i == 0:
        return v, t, p
    if i == 1:
        return q, v, p
    if i == 2:
        return p, v, t
    if i == 3:
        return p, q, v
    if i == 4:
        return t, p, v
    return v, p, q
