"""Matplotlib-based renderer for the CPU aquarium simulation."""
from __future__ import annotations

import math
from typing import List

import matplotlib.pyplot as plt
from matplotlib import animation
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

from .mesh import Mesh
from .simulation import FishState, GoldfishSimulator


class AquariumRenderer:
    """Render :class:`GoldfishSimulator` state using Matplotlib."""

    def __init__(
        self,
        mesh: Mesh,
        simulator: GoldfishSimulator,
        background_color: str = "#021826",
        water_color: str = "#0b3d61",
    ) -> None:
        self.mesh = mesh
        self.simulator = simulator
        self.background_color = background_color
        self.water_color = water_color
        self.fig = plt.figure(figsize=(8, 5))
        self.ax = self.fig.add_subplot(111, projection="3d")
        self.collections: List[Poly3DCollection] = []
        self.surface: Poly3DCollection | None = None
        self._init_scene()

    def _init_scene(self) -> None:
        ax = self.ax
        ax.set_facecolor(self.background_color)
        ax.grid(False)
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_zticks([])
        tank = self.simulator.tank
        half = (tank[0] * 0.5, tank[1] * 0.5, tank[2] * 0.5)
        ax.set_xlim([-half[0], half[0]])
        ax.set_ylim([-half[1], half[1]])
        ax.set_zlim([-half[2] * 0.2, half[2]])
        ax.view_init(elev=25, azim=-60)
        self.fig.subplots_adjust(left=0, right=1, top=1, bottom=0)

        self._draw_tank()
        self._draw_water_surface()

        for _ in self.simulator.fish:
            poly = Poly3DCollection([], edgecolors="#f0c090", linewidths=0.2)
            poly.set_facecolor((1.0, 0.58, 0.32, 0.85))
            self.ax.add_collection3d(poly)
            self.collections.append(poly)

    def _draw_tank(self) -> None:
        tank = self.simulator.tank
        half = (tank[0] * 0.5, tank[1] * 0.5, tank[2])
        corners = [
            (-half[0], -half[1], 0.0),
            (half[0], -half[1], 0.0),
            (half[0], half[1], 0.0),
            (-half[0], half[1], 0.0),
        ]
        top = [(c[0], c[1], c[2] + tank[2]) for c in corners]
        for i in range(4):
            j = (i + 1) % 4
            self.ax.plot(*zip(corners[i], corners[j]), color="#1c5d8a", linewidth=0.6)
            self.ax.plot(*zip(top[i], top[j]), color="#1c5d8a", linewidth=0.6)
            self.ax.plot(*zip(corners[i], top[i]), color="#1c5d8a", linewidth=0.6)

    def _draw_water_surface(self) -> None:
        tank = self.simulator.tank
        half = (tank[0] * 0.5, tank[1] * 0.5)
        verts = [[
            (-half[0], -half[1], tank[2]),
            (half[0], -half[1], tank[2]),
            (half[0], half[1], tank[2]),
            (-half[0], half[1], tank[2]),
        ]]
        surface = Poly3DCollection(verts, alpha=0.18)
        surface.set_facecolor((0.3, 0.55, 0.85, 0.18))
        self.ax.add_collection3d(surface)
        self.surface = surface

    def _transform_mesh(self, fish: FishState) -> List[List[tuple[float, float, float]]]:
        rot = fish.orientation
        faces: List[List[tuple[float, float, float]]] = []
        for tri in self.mesh.faces:
            tri_vertices: List[tuple[float, float, float]] = []
            for idx in tri:
                vx, vy, vz = self.mesh.vertices[idx]
                sx, sy, sz = vx * fish.scale, vy * fish.scale, vz * fish.scale
                rx = rot[0][0] * sx + rot[0][1] * sy + rot[0][2] * sz
                ry = rot[1][0] * sx + rot[1][1] * sy + rot[1][2] * sz
                rz = rot[2][0] * sx + rot[2][1] * sy + rot[2][2] * sz
                tri_vertices.append((rx + fish.position[0], ry + fish.position[1], rz + fish.position[2]))
            faces.append(tri_vertices)
        return faces

    def _update_frame(self, _frame: int, dt: float) -> List[Poly3DCollection]:
        self.simulator.step(dt)
        for fish, collection in zip(self.simulator.states(), self.collections):
            faces = self._transform_mesh(fish)
            collection.set_verts(faces)
            alpha = 0.6 + 0.3 * (0.5 + 0.5 * math.sin(fish.phase))
            collection.set_alpha(alpha)
            collection.set_facecolor((1.0, 0.55 + 0.15 * math.sin(fish.phase), 0.35, alpha))
        if self.surface is not None:
            wave = 0.02 * math.sin(_frame * dt * 1.5)
            verts = self.surface.get_verts()[0]
            animated = [(x, y, self.simulator.tank[2] + wave * math.sin((x + y) * 0.8)) for (x, y, _z) in verts]
            self.surface.set_verts([animated])
        return self.collections

    def animate(self, seconds: float = 30.0, fps: int = 24, save_path: str | None = None) -> animation.FuncAnimation:
        frame_count = int(seconds * fps)
        dt = 1.0 / fps
        anim = animation.FuncAnimation(
            self.fig,
            self._update_frame,
            fargs=(dt,),
            frames=frame_count,
            interval=1000.0 / fps,
            blit=False,
        )
        if save_path:
            anim.save(save_path, fps=fps)
        else:
            plt.show()
        return anim

    def render_single_frame(self, dt: float = 1.0 / 24.0) -> None:
        self._update_frame(0, dt)
        plt.show()
