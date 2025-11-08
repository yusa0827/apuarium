"""Procedural goldfish mesh generator that exports a glTF asset.

The script creates a lightweight, rig-friendly goldfish model composed of a body,
fan tail, dorsal fin, pectoral fins, and pelvic fin. The geometry is analytic and
kept small enough to ship with the repository, while still providing enough detail
for smooth shading and subtle animation in the WebGL viewer.

Run directly to overwrite ``static/models/goldfish.gltf``.
"""
from __future__ import annotations

import base64
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, List, Sequence, Tuple

Vec3 = Tuple[float, float, float]


@dataclass
class AttributeBundle:
    position: List[float]
    normal: List[float]
    uv: List[float]
    indices: List[int]


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def profile_radius(s: float) -> float:
    head = math.exp(-((s - 0.1) / 0.25) ** 2) * 0.06
    mid = math.exp(-((s - 0.45) / 0.32) ** 2) * 0.18
    tail = math.exp(-((s - 0.85) / 0.18) ** 2) * 0.06
    return head + mid + tail + 0.02


def build_body() -> AttributeBundle:
    segments_len = 40
    segments_rad = 32
    positions: List[float] = []
    normals: List[float] = []
    uvs: List[float] = []

    length = 0.35 - (-0.55)

    for j in range(segments_len + 1):
        s = j / segments_len
        x = lerp(-0.55, 0.35, s)
        r = profile_radius(s)
        ds = 1.0 / segments_len
        r_prev = profile_radius(max(0.0, s - ds))
        r_next = profile_radius(min(1.0, s + ds))
        dr = (r_next - r_prev) / (2 * ds)
        dx_ds = length

        for i in range(segments_rad + 1):
            t = i / segments_rad
            theta = t * math.tau
            y = math.cos(theta) * r
            z = math.sin(theta) * r
            positions.extend((x, y, z))

            dy_dt = -math.sin(theta) * r * math.tau
            dz_dt = math.cos(theta) * r * math.tau
            dy_ds = math.cos(theta) * dr
            dz_ds = math.sin(theta) * dr
            tangent_s = (dx_ds, dy_ds, dz_ds)
            tangent_t = (0.0, dy_dt, dz_dt)

            nx = tangent_t[1] * tangent_s[2] - tangent_t[2] * tangent_s[1]
            ny = tangent_t[2] * tangent_s[0] - tangent_t[0] * tangent_s[2]
            nz = tangent_t[0] * tangent_s[1] - tangent_t[1] * tangent_s[0]
            length_n = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            normals.extend((nx / length_n, ny / length_n, nz / length_n))
            uvs.extend((s, t))

    indices: List[int] = []
    stride = segments_rad + 1
    for j in range(segments_len):
        for i in range(segments_rad):
            a = j * stride + i
            b = a + stride
            c = b + 1
            d = a + 1
            indices.extend((a, b, d))
            indices.extend((b, c, d))

    return AttributeBundle(positions, normals, uvs, indices)


def tail_point(u: float, v: float) -> Vec3:
    span = 0.5
    length = 0.65
    x = -0.55 - length * u
    flare = (1 - u) ** 0.4
    y = (v - 0.5) * span * (0.6 + 0.8 * (1 - flare))
    z = (v - 0.5) * span * 1.4 * flare
    sweep = math.sin(u * math.pi * 0.5) * 0.18
    z += sweep * (1 - abs(v - 0.5) * 1.8)
    return (x, y * 0.6, z)


def build_grid(u_count: int, v_count: int, func: Callable[[float, float], Vec3]) -> AttributeBundle:
    positions: List[float] = []
    normals: List[float] = []
    uvs: List[float] = []
    indices: List[int] = []

    def partial(u: float, v: float, axis: int) -> Vec3:
        delta = 1e-3
        if axis == 0:
            a = func(max(0.0, u - delta), v)
            b = func(min(1.0, u + delta), v)
            denom = (min(1.0, u + delta) - max(0.0, u - delta)) or 1e-6
        else:
            a = func(u, max(0.0, v - delta))
            b = func(u, min(1.0, v + delta))
            denom = (min(1.0, v + delta) - max(0.0, v - delta)) or 1e-6
        return ((b[0] - a[0]) / denom, (b[1] - a[1]) / denom, (b[2] - a[2]) / denom)

    for j in range(v_count + 1):
        v = j / v_count
        for i in range(u_count + 1):
            u = i / u_count
            px, py, pz = func(u, v)
            positions.extend((px, py, pz))

            du = partial(u, v, 0)
            dv = partial(u, v, 1)
            nx = du[1] * dv[2] - du[2] * dv[1]
            ny = du[2] * dv[0] - du[0] * dv[2]
            nz = du[0] * dv[1] - du[1] * dv[0]
            length_n = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            normals.extend((nx / length_n, ny / length_n, nz / length_n))
            uvs.extend((u, v))

    stride = u_count + 1
    for j in range(v_count):
        for i in range(u_count):
            a = j * stride + i
            b = a + stride
            c = b + 1
            d = a + 1
            indices.extend((a, b, d))
            indices.extend((b, c, d))

    return AttributeBundle(positions, normals, uvs, indices)


def mirror_positions(data: Sequence[float], axis: str = "z") -> List[float]:
    mirrored: List[float] = []
    for i in range(0, len(data), 3):
        x, y, z = data[i : i + 3]
        if axis == "z":
            mirrored.extend((x, y, -z))
        elif axis == "y":
            mirrored.extend((x, -y, z))
        else:
            mirrored.extend((-x, y, z))
    return mirrored


def mirror_normals(data: Sequence[float], axis: str = "z") -> List[float]:
    return mirror_positions(data, axis)


def build_tail() -> AttributeBundle:
    return build_grid(20, 12, tail_point)


def build_dorsal() -> AttributeBundle:
    def dorsal_func(u: float, v: float) -> Vec3:
        span = 0.26
        height = 0.24
        x = lerp(-0.18, 0.24, u)
        y = 0.12 + (1 - (u - 0.1) ** 2 * 1.8) * height * (1 - abs(v - 0.5) * 0.4)
        z = (v - 0.5) * span * (0.5 + (1 - u) * 0.3)
        return (x, y, z)

    return build_grid(10, 6, dorsal_func)


def build_pectoral_left() -> AttributeBundle:
    def pectoral_func(u: float, v: float) -> Vec3:
        spread = 0.22
        x = lerp(0.02, 0.28, u)
        y = -0.03 + math.sin(u * math.pi) * 0.06 - v * 0.02
        z = 0.12 + (v - 0.5) * spread
        x += math.sin((v - 0.5) * math.pi) * 0.03
        y += math.sin(u * math.pi * 0.5) * 0.02
        return (x, y, z)

    return build_grid(8, 4, pectoral_func)


def build_pelvic() -> AttributeBundle:
    def pelvic_func(u: float, v: float) -> Vec3:
        spread = 0.18
        x = lerp(-0.12, 0.1, u)
        y = -0.12 + (1 - u) * -0.04 + (v - 0.5) * 0.01
        z = (v - 0.5) * spread
        y += math.sin(u * math.pi) * 0.04
        return (x, y, z)

    return build_grid(6, 4, pelvic_func)


def pack_floats(values: Sequence[float]) -> bytes:
    return struct.pack("<%sf" % len(values), *values)


def pack_indices(values: Sequence[int]) -> bytes:
    return struct.pack("<%sH" % len(values), *values)


def add_attribute(
    buffer: bytearray,
    buffer_views: List[dict],
    accessors: List[dict],
    array: Sequence[float | int],
    component_type: int,
    accessor_type: str,
    target: int,
) -> int:
    if component_type == 5126:
        data = pack_floats(array)  # type: ignore[arg-type]
        comps = {"VEC2": 2, "VEC3": 3}[accessor_type]
        count = len(array) // comps
        mins = [min(array[i::comps]) for i in range(comps)]
        maxs = [max(array[i::comps]) for i in range(comps)]
    else:
        data = pack_indices(array)  # type: ignore[arg-type]
        count = len(array)
        mins = [int(min(array))]
        maxs = [int(max(array))]

    while len(buffer) % 4:
        buffer.extend(b"\x00")
    offset = len(buffer)
    buffer.extend(data)
    byte_length = len(data)
    while len(buffer) % 4:
        buffer.extend(b"\x00")

    buffer_view = {
        "buffer": 0,
        "byteOffset": offset,
        "byteLength": byte_length,
        "target": target,
    }
    buffer_views.append(buffer_view)

    accessor = {
        "bufferView": len(buffer_views) - 1,
        "componentType": component_type,
        "count": count,
        "type": accessor_type,
        "min": mins,
        "max": maxs,
    }
    accessors.append(accessor)
    return len(accessors) - 1


def write_gltf(output: Path) -> None:
    body = build_body()
    tail = build_tail()
    dorsal = build_dorsal()
    pect_l = build_pectoral_left()
    pect_r = AttributeBundle(
        mirror_positions(pect_l.position, "z"),
        mirror_normals(pect_l.normal, "z"),
        list(pect_l.uv),
        list(pect_l.indices),
    )
    pelvic = build_pelvic()

    buffer = bytearray()
    buffer_views: List[dict] = []
    accessors: List[dict] = []

    def add_bundle(bundle: AttributeBundle, target: int = 34962, index_target: int = 34963) -> Tuple[int, int, int, int]:
        pos = add_attribute(buffer, buffer_views, accessors, bundle.position, 5126, "VEC3", target)
        normal = add_attribute(buffer, buffer_views, accessors, bundle.normal, 5126, "VEC3", target)
        uv = add_attribute(buffer, buffer_views, accessors, bundle.uv, 5126, "VEC2", target)
        idx = add_attribute(buffer, buffer_views, accessors, bundle.indices, 5123, "SCALAR", index_target)
        return pos, normal, uv, idx

    body_pos, body_nor, body_uv, body_idx = add_bundle(body)
    tail_pos, tail_nor, tail_uv, tail_idx = add_bundle(tail)
    dorsal_pos, dorsal_nor, dorsal_uv, dorsal_idx = add_bundle(dorsal)
    pect_l_pos, pect_l_nor, pect_l_uv, pect_l_idx = add_bundle(pect_l)
    pect_r_pos, pect_r_nor, pect_r_uv, pect_r_idx = add_bundle(pect_r)
    pelvic_pos, pelvic_nor, pelvic_uv, pelvic_idx = add_bundle(pelvic)

    buffer_uri = "data:application/octet-stream;base64," + base64.b64encode(buffer).decode()

    materials = [
        {
            "name": "BodyMaterial",
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 0.52, 0.3, 1.0],
                "metallicFactor": 0.05,
                "roughnessFactor": 0.35,
            },
            "emissiveFactor": [0.08, 0.02, 0.0],
        },
        {
            "name": "FinMaterial",
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 0.74, 0.55, 0.7],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.6,
            },
            "alphaMode": "BLEND",
            "doubleSided": True,
            "emissiveFactor": [0.05, 0.02, 0.01],
        },
    ]

    meshes = [
        {
            "name": "Body",
            "primitives": [
                {
                    "attributes": {
                        "POSITION": body_pos,
                        "NORMAL": body_nor,
                        "TEXCOORD_0": body_uv,
                    },
                    "indices": body_idx,
                    "material": 0,
                }
            ],
        },
        {
            "name": "Tail",
            "primitives": [
                {
                    "attributes": {
                        "POSITION": tail_pos,
                        "NORMAL": tail_nor,
                        "TEXCOORD_0": tail_uv,
                    },
                    "indices": tail_idx,
                    "material": 1,
                }
            ],
        },
        {
            "name": "Dorsal",
            "primitives": [
                {
                    "attributes": {
                        "POSITION": dorsal_pos,
                        "NORMAL": dorsal_nor,
                        "TEXCOORD_0": dorsal_uv,
                    },
                    "indices": dorsal_idx,
                    "material": 1,
                }
            ],
        },
        {
            "name": "PectoralL",
            "primitives": [
                {
                    "attributes": {
                        "POSITION": pect_l_pos,
                        "NORMAL": pect_l_nor,
                        "TEXCOORD_0": pect_l_uv,
                    },
                    "indices": pect_l_idx,
                    "material": 1,
                }
            ],
        },
        {
            "name": "PectoralR",
            "primitives": [
                {
                    "attributes": {
                        "POSITION": pect_r_pos,
                        "NORMAL": pect_r_nor,
                        "TEXCOORD_0": pect_r_uv,
                    },
                    "indices": pect_r_idx,
                    "material": 1,
                }
            ],
        },
        {
            "name": "Pelvic",
            "primitives": [
                {
                    "attributes": {
                        "POSITION": pelvic_pos,
                        "NORMAL": pelvic_nor,
                        "TEXCOORD_0": pelvic_uv,
                    },
                    "indices": pelvic_idx,
                    "material": 1,
                }
            ],
        },
    ]

    nodes = [
        {
            "name": "Goldfish",
            "children": [1, 2, 3, 4, 5, 6],
        },
        {
            "name": "Body",
            "mesh": 0,
        },
        {
            "name": "Tail",
            "mesh": 1,
            "translation": [-0.55, 0.0, 0.0],
        },
        {
            "name": "Dorsal",
            "mesh": 2,
        },
        {
            "name": "PectoralL",
            "mesh": 3,
        },
        {
            "name": "PectoralR",
            "mesh": 4,
        },
        {
            "name": "Pelvic",
            "mesh": 5,
        },
    ]

    model = {
        "asset": {"version": "2.0", "generator": "procedural-goldfish"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "buffers": [{"byteLength": len(buffer), "uri": buffer_uri}],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(model, indent=2))


if __name__ == "__main__":
    write_gltf(Path("static/models/goldfish.gltf"))
