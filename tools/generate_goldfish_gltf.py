"""Procedural goldfish mesh generator that exports a glTF asset.

The generator sculpts a stylised, super-deformed ranchu-inspired goldfish with a
pudgy head, flowing double tail, and translucent fins. Everything is produced
mathematically so no bitmap textures are required. The resulting mesh is still
compact enough to ship with the repository while containing enough curvature for
Three.js to light it believably.

Run directly to overwrite ``static/models/goldfish.gltf``.
"""
from __future__ import annotations

import base64
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Sequence, Tuple

Vec3 = Tuple[float, float, float]


@dataclass
class AttributeBundle:
    position: List[float]
    normal: List[float]
    uv: List[float]
    indices: List[int]
    color: List[float] | None = None


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def clamp(x: float, low: float, high: float) -> float:
    return max(low, min(high, x))


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    t = clamp((x - edge0) / (edge1 - edge0 or 1e-6), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def profile_radius(s: float) -> float:
    head = math.exp(-((s - 0.08) / 0.18) ** 2) * 0.1
    belly = math.exp(-((s - 0.42) / 0.28) ** 2) * 0.22
    peduncle = math.exp(-((s - 0.72) / 0.2) ** 2) * 0.1
    tail_root = math.exp(-((s - 0.9) / 0.12) ** 2) * 0.05
    return 0.04 + head + belly + peduncle + tail_root


def build_body() -> AttributeBundle:
    segments_len = 48
    segments_rad = 36
    positions: List[float] = []
    normals: List[float] = []
    uvs: List[float] = []
    colors: List[float] = []

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

            # Vertex color palette blending for an even cuter look
            norm_y = clamp((y / (r + 1e-6) + 1.0) * 0.5, 0.0, 1.0)
            norm_z = clamp((z / (r + 1e-6) + 1.0) * 0.5, 0.0, 1.0)
            length_mix = smoothstep(0.12, 0.82, s)
            cheek = math.exp(-((s - 0.82) / 0.11) ** 2) * 0.65
            gill = math.exp(-((s - 0.27) / 0.06) ** 2) * 0.4
            sparkle = clamp(0.4 + 0.6 * max(0.0, nz), 0.0, 1.0)

            belly_color = (1.0, 0.92, 0.83)
            mid_color = (1.0, 0.63, 0.38)
            top_color = (1.0, 0.46, 0.24)
            cheek_color = (1.0, 0.54, 0.5)
            gill_color = (1.0, 0.5, 0.4)

            top_mix = tuple(
                belly_color[i] * (1.0 - norm_y) + top_color[i] * norm_y for i in range(3)
            )
            warm = tuple(
                top_mix[i] * (1.0 - 0.45 * length_mix) + mid_color[i] * (0.45 * length_mix)
                for i in range(3)
            )
            cheek_mix = tuple(
                warm[i] * (1.0 - cheek) + cheek_color[i] * cheek for i in range(3)
            )
            gilled = tuple(
                cheek_mix[i] * (1.0 - gill) + gill_color[i] * gill for i in range(3)
            )
            highlight = tuple(
                min(1.0, gilled[i] + 0.09 * sparkle + 0.04 * (1.0 - norm_z)) for i in range(3)
            )
            colors.extend((*highlight, 1.0))

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

    return AttributeBundle(positions, normals, uvs, indices, colors)


def tail_point(u: float, v: float) -> Vec3:
    length = 0.68
    x = -0.55 - length * u
    centre = v - 0.5
    sign = 1.0 if centre >= 0 else -1.0
    spread = 0.55 + 0.35 * (1.0 - u)
    lobe = (abs(centre) ** 0.55) * spread
    pinch = smoothstep(0.0, 0.45, abs(centre))
    ribbon = 0.12 * (1.0 - u) * (1.0 - pinch)

    y = sign * lobe * (0.58 + 0.28 * (1.0 - u)) + ribbon
    z = sign * lobe * (0.96 + 0.32 * (1.0 - u))

    sweep = math.sin(u * math.pi * 0.6) * 0.22
    flutter = math.sin((v - 0.5) * math.pi * 2.6) * 0.05 * (1.0 - u)
    z += sweep * (1.0 - abs(centre) * 1.6) + flutter
    y += math.cos(u * math.pi * 1.1) * 0.03 * sign * (1.0 - abs(centre) * 1.4)

    notch = (1.0 - smoothstep(0.1, 0.32, abs(centre)))
    y += notch * 0.08 * (1.0 - u)
    z -= sign * notch * 0.03 * (1.0 - u)

    return (x, y * 0.58, z)


def build_grid(
    u_count: int,
    v_count: int,
    func: Callable[[float, float], Vec3],
    color_func: Callable[[float, float, Vec3, Vec3], Tuple[float, float, float, float]] | None = None,
) -> AttributeBundle:
    positions: List[float] = []
    normals: List[float] = []
    uvs: List[float] = []
    indices: List[int] = []
    colors: List[float] = []

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
            nx /= length_n
            ny /= length_n
            nz /= length_n
            normals.extend((nx, ny, nz))
            uvs.extend((u, v))

            if color_func is not None:
                cr, cg, cb, ca = color_func(u, v, (px, py, pz), (nx, ny, nz))
                colors.extend((cr, cg, cb, ca))

    stride = u_count + 1
    for j in range(v_count):
        for i in range(u_count):
            a = j * stride + i
            b = a + stride
            c = b + 1
            d = a + 1
            indices.extend((a, b, d))
            indices.extend((b, c, d))

    return AttributeBundle(positions, normals, uvs, indices, colors if color_func else None)


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
    def tail_color(u: float, v: float, pos: Vec3, normal: Vec3) -> Tuple[float, float, float, float]:
        tip = smoothstep(0.2, 1.0, u)
        centre = abs(v - 0.5) * 2.0
        lace = math.cos((1.0 - u) * 2.8 + centre * 3.2) * 0.5 + 0.5
        base = (1.0, 0.76, 0.56)
        tip_tint = (1.0, 0.5, 0.38)
        rim = (1.0, 0.6, 0.48)
        mix = tuple(base[i] * (1.0 - tip) + tip_tint[i] * tip for i in range(3))
        color = tuple(
            min(1.0, mix[i] * (0.92 + 0.08 * lace) + rim[i] * (0.12 * (1.0 - centre)))
            for i in range(3)
        )
        alpha = clamp(0.82 - 0.55 * tip + 0.18 * (1.0 - centre), 0.28, 0.88)
        shimmer = clamp(0.55 + 0.45 * max(0.0, normal[2]), 0.0, 1.0)
        color = tuple(min(1.0, c + 0.05 * shimmer) for c in color)
        return (*color, alpha)

    return build_grid(20, 12, tail_point, tail_color)


def build_dorsal() -> AttributeBundle:
    def dorsal_func(u: float, v: float) -> Vec3:
        span = 0.32
        height = 0.26
        x = lerp(-0.22, 0.28, u)
        crown = math.sin((u + 0.2) * math.pi * 0.7) ** 1.6
        y = 0.14 + crown * height * (1 - abs(v - 0.5) * 0.5)
        z = (v - 0.5) * span * (0.45 + 0.4 * (1 - u))
        z += math.sin((v - 0.5) * math.pi * 2.0) * 0.05 * (1 - u)
        return (x, y, z)

    def dorsal_color(u: float, v: float, pos: Vec3, normal: Vec3) -> Tuple[float, float, float, float]:
        tip = smoothstep(0.15, 1.0, u)
        edge = abs(v - 0.5) * 2.0
        base = (1.0, 0.74, 0.54)
        tip_tint = (1.0, 0.56, 0.4)
        color = tuple(base[i] * (1.0 - tip) + tip_tint[i] * tip for i in range(3))
        color = tuple(min(1.0, color[i] + 0.04 * (1.0 - edge)) for i in range(3))
        alpha = clamp(0.8 - 0.45 * tip - 0.15 * edge, 0.3, 0.85)
        return (*color, alpha)

    return build_grid(10, 6, dorsal_func, dorsal_color)


def build_pectoral_left() -> AttributeBundle:
    def pectoral_func(u: float, v: float) -> Vec3:
        spread = 0.28
        x = lerp(0.01, 0.32, u)
        y = -0.035 + math.sin(u * math.pi * 0.9) * 0.07 - v * 0.02
        z = 0.14 + (v - 0.5) * spread
        x += math.sin((v - 0.5) * math.pi) * 0.035
        y += math.sin(u * math.pi * 0.7) * 0.025
        z += math.sin(u * math.pi * 1.3) * 0.015
        return (x, y, z)

    def pectoral_color(u: float, v: float, pos: Vec3, normal: Vec3) -> Tuple[float, float, float, float]:
        root = smoothstep(0.0, 0.28, u)
        tip = smoothstep(0.45, 1.0, u)
        warm = (1.0, 0.76, 0.58)
        cool = (1.0, 0.6, 0.48)
        color = tuple(warm[i] * (1.0 - tip) + cool[i] * tip for i in range(3))
        color = tuple(color[i] * (0.9 + 0.12 * root) for i in range(3))
        alpha = clamp(0.74 - 0.4 * tip + 0.06 * (1.0 - abs(v - 0.5) * 2.0), 0.25, 0.82)
        return (*color, alpha)

    return build_grid(8, 4, pectoral_func, pectoral_color)


def build_pelvic() -> AttributeBundle:
    def pelvic_func(u: float, v: float) -> Vec3:
        spread = 0.22
        x = lerp(-0.16, 0.08, u)
        y = -0.13 + (1 - u) * -0.05 + (v - 0.5) * 0.012
        z = (v - 0.5) * spread
        y += math.sin(u * math.pi * 0.9) * 0.045
        z += math.sin((v - 0.5) * math.pi) * 0.015
        return (x, y, z)

    def pelvic_color(u: float, v: float, pos: Vec3, normal: Vec3) -> Tuple[float, float, float, float]:
        tip = smoothstep(0.25, 1.0, u)
        blush = (1.0, 0.62, 0.46)
        pale = (1.0, 0.8, 0.62)
        color = tuple(pale[i] * (1.0 - tip) + blush[i] * tip for i in range(3))
        color = tuple(min(1.0, color[i] + 0.05 * (1.0 - abs(v - 0.5) * 2.0)) for i in range(3))
        alpha = clamp(0.72 - 0.42 * tip, 0.28, 0.78)
        return (*color, alpha)

    return build_grid(6, 4, pelvic_func, pelvic_color)


def pack_floats(values: Sequence[float]) -> bytes:
    return struct.pack("<%sf" % len(values), *values)


def pack_indices(values: Sequence[int]) -> bytes:
    return struct.pack("<%sH" % len(values), *values)


def build_eye(radius: float, lat_segments: int, lon_segments: int) -> AttributeBundle:
    positions: List[float] = []
    normals: List[float] = []
    uvs: List[float] = []
    indices: List[int] = []

    for iy in range(lat_segments + 1):
        v = iy / lat_segments
        phi = v * math.pi
        sin_phi = math.sin(phi)
        cos_phi = math.cos(phi)

        for ix in range(lon_segments + 1):
            u = ix / lon_segments
            theta = u * math.tau
            sin_theta = math.sin(theta)
            cos_theta = math.cos(theta)

            nx = sin_phi * cos_theta
            ny = cos_phi
            nz = sin_phi * sin_theta
            positions.extend((radius * nx, radius * ny, radius * nz))
            normals.extend((nx, ny, nz))
            uvs.extend((u, v))

    stride = lon_segments + 1
    for iy in range(lat_segments):
        for ix in range(lon_segments):
            a = iy * stride + ix
            b = a + stride
            c = b + 1
            d = a + 1
            indices.extend((a, b, d))
            indices.extend((b, c, d))

    return AttributeBundle(positions, normals, uvs, indices)


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
        comps = {"VEC2": 2, "VEC3": 3, "VEC4": 4}[accessor_type]
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
        list(pect_l.color) if pect_l.color else None,
    )
    pelvic = build_pelvic()
    eye_white = build_eye(0.085, 16, 22)
    eye_pupil = build_eye(0.04, 12, 18)

    buffer = bytearray()
    buffer_views: List[dict] = []
    accessors: List[dict] = []

    def add_bundle(
        bundle: AttributeBundle,
        target: int = 34962,
        index_target: int = 34963,
    ) -> Tuple[dict, int]:
        attributes = {
            "POSITION": add_attribute(buffer, buffer_views, accessors, bundle.position, 5126, "VEC3", target),
            "NORMAL": add_attribute(buffer, buffer_views, accessors, bundle.normal, 5126, "VEC3", target),
            "TEXCOORD_0": add_attribute(buffer, buffer_views, accessors, bundle.uv, 5126, "VEC2", target),
        }
        if bundle.color:
            attributes["COLOR_0"] = add_attribute(
                buffer,
                buffer_views,
                accessors,
                bundle.color,
                5126,
                "VEC4",
                target,
            )
        idx = add_attribute(buffer, buffer_views, accessors, bundle.indices, 5123, "SCALAR", index_target)
        return attributes, idx

    body_attr, body_idx = add_bundle(body)
    tail_attr, tail_idx = add_bundle(tail)
    dorsal_attr, dorsal_idx = add_bundle(dorsal)
    pect_l_attr, pect_l_idx = add_bundle(pect_l)
    pect_r_attr, pect_r_idx = add_bundle(pect_r)
    pelvic_attr, pelvic_idx = add_bundle(pelvic)
    eye_white_attr, eye_white_idx = add_bundle(eye_white)
    eye_pupil_attr, eye_pupil_idx = add_bundle(eye_pupil)

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
        {
            "name": "EyeWhite",
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 0.98, 0.95, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.35,
            },
            "emissiveFactor": [0.15, 0.15, 0.18],
        },
        {
            "name": "EyePupil",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.08, 0.08, 0.12, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.1,
            },
            "emissiveFactor": [0.02, 0.02, 0.04],
        },
    ]

    meshes = [
        {
            "name": "Body",
            "primitives": [
                {
                    "attributes": body_attr,
                    "indices": body_idx,
                    "material": 0,
                }
            ],
        },
        {
            "name": "Tail",
            "primitives": [
                {
                    "attributes": tail_attr,
                    "indices": tail_idx,
                    "material": 1,
                }
            ],
        },
        {
            "name": "Dorsal",
            "primitives": [
                {
                    "attributes": dorsal_attr,
                    "indices": dorsal_idx,
                    "material": 1,
                }
            ],
        },
        {
            "name": "PectoralL",
            "primitives": [
                {
                    "attributes": pect_l_attr,
                    "indices": pect_l_idx,
                    "material": 1,
                }
            ],
        },
        {
            "name": "PectoralR",
            "primitives": [
                {
                    "attributes": pect_r_attr,
                    "indices": pect_r_idx,
                    "material": 1,
                }
            ],
        },
        {
            "name": "Pelvic",
            "primitives": [
                {
                    "attributes": pelvic_attr,
                    "indices": pelvic_idx,
                    "material": 1,
                }
            ],
        },
        {
            "name": "EyeWhite",
            "primitives": [
                {
                    "attributes": eye_white_attr,
                    "indices": eye_white_idx,
                    "material": 2,
                }
            ],
        },
        {
            "name": "EyePupil",
            "primitives": [
                {
                    "attributes": eye_pupil_attr,
                    "indices": eye_pupil_idx,
                    "material": 3,
                }
            ],
        },
    ]

    nodes = [
        {
            "name": "Goldfish",
            "children": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
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
        {
            "name": "EyeLeftWhite",
            "mesh": 6,
            "translation": [0.26, 0.03, 0.12],
        },
        {
            "name": "EyeRightWhite",
            "mesh": 6,
            "translation": [0.26, 0.03, -0.12],
        },
        {
            "name": "EyeLeftPupil",
            "mesh": 7,
            "translation": [0.29, 0.035, 0.13],
            "scale": [0.9, 1.05, 0.9],
        },
        {
            "name": "EyeRightPupil",
            "mesh": 7,
            "translation": [0.29, 0.035, -0.13],
            "scale": [0.9, 1.05, 0.9],
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
