"""Procedural goldfish mesh generator."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Tuple

from .mesh import Face, Mesh, Vector3


@dataclass
class GoldfishParameters:
    """Shape parameters describing the generated goldfish."""

    length: float = 1.2
    body_segments: int = 28
    radial_segments: int = 36
    tail_segments: int = 12
    body_radius: float = 0.28
    tail_length: float = 0.55
    fin_length: float = 0.45
    dorsal_height: float = 0.35
    pectoral_length: float = 0.25
    belly_drop: float = 0.12


def _body_profile(params: GoldfishParameters) -> Tuple[List[float], List[float], List[float]]:
    body_segments = params.body_segments
    xs: List[float] = []
    radii_y: List[float] = []
    radii_z: List[float] = []
    for i in range(body_segments):
        t = i / (body_segments - 1)
        xs.append((t - 0.5) * params.length)
        bulge = math.sin(math.pi * t) ** 0.7
        taper_head = 1.0 - 0.3 * math.exp(-t * 9.0)
        taper_tail = 1.0 - 0.7 * math.exp(-(1.0 - t) * 5.0)
        radius = params.body_radius * bulge * taper_head * taper_tail
        radii_y.append(radius)
        radii_z.append(max(0.05, radius * (0.7 + 0.25 * (1.0 - abs(t - 0.5) * 2.0)) - params.belly_drop * (0.5 - t)))
    return xs, radii_y, radii_z


def _lathe_mesh(xs: List[float], radii_y: List[float], radii_z: List[float], radial_segments: int) -> Mesh:
    vertices: List[Vector3] = []
    faces: List[Face] = []
    rings = len(xs)
    for i in range(rings):
        x = xs[i]
        ry = radii_y[i]
        rz = radii_z[i]
        for j in range(radial_segments):
            theta = 2.0 * math.pi * j / radial_segments
            y = math.cos(theta) * ry
            z = math.sin(theta) * rz
            vertices.append((x, y, z))
    for i in range(rings - 1):
        for j in range(radial_segments):
            i0 = i * radial_segments + j
            i1 = i * radial_segments + (j + 1) % radial_segments
            i2 = (i + 1) * radial_segments + (j + 1) % radial_segments
            i3 = (i + 1) * radial_segments + j
            faces.append((i0, i1, i2))
            faces.append((i0, i2, i3))
    return Mesh(vertices, faces)


def _generate_tail(mesh: Mesh, params: GoldfishParameters) -> None:
    radial_segments = params.radial_segments
    base_offset = (params.body_segments - 1) * radial_segments
    current_vertex_count = len(mesh.vertices)
    tail_vertices: List[Vector3] = []
    tail_faces: List[Face] = []
    for t in range(1, params.tail_segments + 1):
        w = (1.0 - t / params.tail_segments) ** 1.3
        width_y = params.body_radius * 0.8 * w
        width_z = params.body_radius * 1.4 * w
        x_offset = params.length * 0.5 + params.tail_length * (t / params.tail_segments) ** 1.2
        for j in range(radial_segments):
            theta = 2.0 * math.pi * j / radial_segments
            y = math.cos(theta) * width_y * math.sin(theta * 0.5)
            z = math.sin(theta) * width_z * (0.5 + 0.5 * w)
            tail_vertices.append((x_offset, y, z))
    mesh.vertices.extend(tail_vertices)

    for layer in range(params.tail_segments - 1):
        for j in range(radial_segments):
            ring0 = current_vertex_count + layer * radial_segments
            ring1 = current_vertex_count + (layer + 1) * radial_segments
            i0 = ring0 + j
            i1 = ring0 + (j + 1) % radial_segments
            i2 = ring1 + (j + 1) % radial_segments
            i3 = ring1 + j
            tail_faces.append((i0, i1, i2))
            tail_faces.append((i0, i2, i3))
    last_body_ring = base_offset
    for j in range(radial_segments):
        i0 = last_body_ring + j
        i1 = last_body_ring + (j + 1) % radial_segments
        i2 = current_vertex_count + (j + 1) % radial_segments
        i3 = current_vertex_count + j
        tail_faces.append((i0, i1, i2))
        tail_faces.append((i0, i2, i3))
    mesh.faces.extend(tail_faces)


def _append_fin(mesh: Mesh, base_position: Vector3, direction: Vector3,
                length: float, width: float, thickness: float, wave_phase: float) -> None:
    bx, by, bz = base_position
    dx, dy, dz = direction
    norm = math.sqrt(dx * dx + dy * dy + dz * dz)
    if norm == 0:
        norm = 1.0
    dx, dy, dz = dx / norm, dy / norm, dz / norm
    up = (0.0, 0.0, 1.0)
    right = (
        dy * up[2] - dz * up[1],
        dz * up[0] - dx * up[2],
        dx * up[1] - dy * up[0],
    )
    right_len = math.sqrt(right[0] * right[0] + right[1] * right[1] + right[2] * right[2])
    if right_len < 1e-6:
        right = (1.0, 0.0, 0.0)
    else:
        right = (right[0] / right_len, right[1] / right_len, right[2] / right_len)
    up = (
        dy * right[2] - dz * right[1],
        dz * right[0] - dx * right[2],
        dx * right[1] - dy * right[0],
    )
    tip = (bx + dx * length, by + dy * length, bz + dz * length)
    flap = (right[0] * width + up[0] * thickness,
            right[1] * width + up[1] * thickness,
            right[2] * width + up[2] * thickness)
    v0 = (bx - flap[0], by - flap[1], bz - flap[2])
    v1 = (bx + flap[0], by + flap[1], bz + flap[2])
    v2 = (tip[0] + flap[0] * wave_phase, tip[1] + flap[1] * wave_phase, tip[2] + flap[2] * wave_phase)
    v3 = (tip[0] - flap[0] * wave_phase, tip[1] - flap[1] * wave_phase, tip[2] - flap[2] * wave_phase)
    start = len(mesh.vertices)
    mesh.vertices.extend([v0, v1, v2, v3])
    mesh.faces.extend([(start, start + 1, start + 2), (start, start + 2, start + 3)])


def generate_goldfish_mesh(params: GoldfishParameters | None = None) -> Mesh:
    params = params or GoldfishParameters()
    xs, radii_y, radii_z = _body_profile(params)
    mesh = _lathe_mesh(xs, radii_y, radii_z, params.radial_segments)
    _generate_tail(mesh, params)

    dorsal_base = (0.0, 0.0, max(radii_z) * 0.95)
    _append_fin(mesh, dorsal_base, (0.2, 0.0, 0.5), params.dorsal_height, params.dorsal_height * 0.4, 0.02, 0.6)

    fin_base_left = (-params.length * 0.1, params.body_radius * 0.8, -params.belly_drop)
    fin_base_right = (-params.length * 0.1, -params.body_radius * 0.8, -params.belly_drop)
    _append_fin(mesh, fin_base_left, (0.15, 0.6, 0.2), params.pectoral_length, params.pectoral_length * 0.5, 0.015, 0.3)
    _append_fin(mesh, fin_base_right, (0.15, -0.6, 0.2), params.pectoral_length, params.pectoral_length * 0.5, 0.015, 0.3)

    pelvic_base = (-params.length * 0.05, 0.0, -max(radii_z) * 1.1)
    _append_fin(mesh, pelvic_base, (0.2, 0.0, -0.8), params.fin_length * 0.7, params.fin_length * 0.3, 0.018, 0.5)

    mesh.compute_normals()
    return mesh
