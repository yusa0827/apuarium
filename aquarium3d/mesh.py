"""Basic mesh utilities used by the procedural goldfish generator."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Sequence, Tuple

Vector3 = Tuple[float, float, float]
Face = Tuple[int, int, int]
Matrix3 = Tuple[Tuple[float, float, float], Tuple[float, float, float], Tuple[float, float, float]]


def _vec_add(a: Vector3, b: Vector3) -> Vector3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _vec_sub(a: Vector3, b: Vector3) -> Vector3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _vec_cross(a: Vector3, b: Vector3) -> Vector3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _vec_scale(v: Vector3, s: float) -> Vector3:
    return (v[0] * s, v[1] * s, v[2] * s)


def _vec_length(v: Vector3) -> float:
    return (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) ** 0.5


def _vec_normalize(v: Vector3) -> Vector3:
    length = _vec_length(v)
    if length == 0.0:
        return (0.0, 0.0, 0.0)
    return (v[0] / length, v[1] / length, v[2] / length)


@dataclass
class Mesh:
    """Simple triangular mesh container."""

    vertices: List[Vector3]
    faces: List[Face]
    normals: List[Vector3] | None = None

    def copy(self) -> "Mesh":
        return Mesh(list(self.vertices), list(self.faces), None if self.normals is None else list(self.normals))

    def compute_normals(self) -> None:
        """Compute per-vertex normals using an area-weighted face average."""

        normals: List[Vector3] = [(0.0, 0.0, 0.0) for _ in self.vertices]
        for tri in self.faces:
            p0, p1, p2 = (self.vertices[idx] for idx in tri)
            n = _vec_cross(_vec_sub(p1, p0), _vec_sub(p2, p0))
            for idx in tri:
                normals[idx] = _vec_add(normals[idx], n)
        self.normals = [_vec_normalize(n) for n in normals]

    def transformed(self, rotation: Matrix3, translation: Iterable[float], scale: float = 1.0) -> "Mesh":
        tx, ty, tz = translation
        rot = rotation
        transformed_vertices: List[Vector3] = []
        for vx, vy, vz in self.vertices:
            sx, sy, sz = vx * scale, vy * scale, vz * scale
            rx = rot[0][0] * sx + rot[0][1] * sy + rot[0][2] * sz
            ry = rot[1][0] * sx + rot[1][1] * sy + rot[1][2] * sz
            rz = rot[2][0] * sx + rot[2][1] * sy + rot[2][2] * sz
            transformed_vertices.append((rx + tx, ry + ty, rz + tz))
        normals = None
        if self.normals is not None:
            transformed_normals: List[Vector3] = []
            for nx, ny, nz in self.normals:
                rx = rot[0][0] * nx + rot[0][1] * ny + rot[0][2] * nz
                ry = rot[1][0] * nx + rot[1][1] * ny + rot[1][2] * nz
                rz = rot[2][0] * nx + rot[2][1] * ny + rot[2][2] * nz
                transformed_normals.append(_vec_normalize((rx, ry, rz)))
            normals = transformed_normals
        return Mesh(transformed_vertices, list(self.faces), normals)

    def to_triangulated_faces(self) -> List[List[Vector3]]:
        return [[self.vertices[idx] for idx in tri] for tri in self.faces]

    def to_obj(self) -> str:
        if self.normals is None:
            self.compute_normals()
        lines: List[str] = []
        for v in self.vertices:
            lines.append(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}")
        assert self.normals is not None
        for n in self.normals:
            lines.append(f"vn {n[0]:.6f} {n[1]:.6f} {n[2]:.6f}")
        for tri in self.faces:
            i0, i1, i2 = tri[0] + 1, tri[1] + 1, tri[2] + 1
            lines.append(f"f {i0}//{i0} {i1}//{i1} {i2}//{i2}")
        return "\n".join(lines) + "\n"


__all__ = ["Mesh", "Vector3", "Face", "Matrix3"]
