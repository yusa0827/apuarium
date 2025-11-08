"""Utility package for procedurally generated goldfish meshes and CPU-side aquarium simulation."""
from __future__ import annotations

from typing import TYPE_CHECKING

from .goldfish import GoldfishParameters, generate_goldfish_mesh
from .simulation import FishState, GoldfishSimulator
from .mesh import Mesh

__all__ = [
    "generate_goldfish_mesh",
    "GoldfishParameters",
    "GoldfishSimulator",
    "FishState",
    "Mesh",
    "AquariumRenderer",
]

if TYPE_CHECKING:  # pragma: no cover
    from .renderer import AquariumRenderer


def __getattr__(name: str):
    if name == "AquariumRenderer":
        from .renderer import AquariumRenderer as _Renderer

        return _Renderer
    raise AttributeError(name)
