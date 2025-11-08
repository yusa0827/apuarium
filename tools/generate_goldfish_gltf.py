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
    """Smooth body radius along the longitudinal axis.

    The previous profile produced a streamlined silhouette. For the refreshed
    model we exaggerate the cheeks and belly to give the fish a rounder,
    doll-like appearance while keeping a taper towards the tail for elegance.
    """

    head = math.exp(-((s - 0.12) / 0.18) ** 2) * 0.14
    belly = math.exp(-((s - 0.45) / 0.25) ** 2) * 0.28
    tail_root = math.exp(-((s - 0.75) / 0.22) ** 2) * 0.16
    return head + belly + tail_root + 0.04


def build_body() -> AttributeBundle:
    segments_len = 44
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

            # Vertex color palette blending for a pastel, toy-like finish.
            norm_y = clamp((y / (r + 1e-6) + 1.0) * 0.5, 0.0, 1.0)
            cheek_weight = math.exp(-((s - 0.78) / 0.11) ** 2)
            face_weight = math.exp(-((s - 0.18) / 0.18) ** 2)
            tail_weight = smoothstep(0.6, 1.0, s)
            sparkle = clamp(0.55 + 0.45 * max(0.0, ny), 0.0, 1.0)

            pearl = (1.0, 0.94, 0.9)
            blush = (1.0, 0.72, 0.68)
            dorsal = (0.98, 0.56, 0.42)
            crown = (1.0, 0.82, 0.52)

            belly = tuple(pearl[i] * (1.0 - norm_y) + blush[i] * norm_y for i in range(3))
            midtone = tuple(
                belly[i] * (1.0 - face_weight * 0.55) + crown[i] * (face_weight * 0.55)
                for i in range(3)
            )
            dorsal_mix = tuple(
                midtone[i] * (1.0 - 0.5 * tail_weight) + dorsal[i] * (0.5 * tail_weight)
                for i in range(3)
            )
            cheek_mix = tuple(
                dorsal_mix[i] * (1.0 - 0.6 * cheek_weight)
                + blush[i] * (0.6 * cheek_weight)
                for i in range(3)
            )
            highlight = tuple(min(1.0, cheek_mix[i] + 0.1 * sparkle) for i in range(3))
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
    """Double-lobed fantail shape with gentle curvature."""

    length = 0.72
    span = 0.82
    x = -0.55 - (u ** 1.1) * length
    flare = smoothstep(0.0, 1.0, 1.0 - u)
    theta = (v - 0.5) * math.pi
    fan = math.sin(abs(theta)) ** 0.75
    split = math.sin(theta * 2.0) * 0.35 * (1.0 - u) ** 1.2
    y = (v - 0.5) * span * (0.55 + 0.45 * flare)
    y += split * 0.12
    z = fan * span * (0.35 + 0.45 * flare)
    z *= 1.0 if v >= 0.5 else -1.0
    sweep = math.sin(u * math.pi * 0.6) * 0.22
    z += sweep * (1.0 - abs(v - 0.5) ** 1.5)
    return (x, y * 0.52, z)


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
        tip = smoothstep(0.3, 1.0, u)
        lobe = abs(v - 0.5) * 2.0
        shimmer = clamp(0.65 + 0.35 * max(0.0, normal[2]), 0.0, 1.0)
        root = (1.0, 0.8, 0.64)
        lobe_tint = (1.0, 0.6, 0.72)
        tip_tint = (0.98, 0.58, 0.98)
        base = tuple(root[i] * (1.0 - tip) + lobe_tint[i] * tip for i in range(3))
        color = tuple(base[i] * (1.0 - 0.45 * lobe) + tip_tint[i] * (0.45 * lobe) for i in range(3))
        color = tuple(min(1.0, c + 0.08 * shimmer) for c in color)
        alpha = clamp(0.75 - 0.32 * tip + 0.12 * (1.0 - lobe), 0.22, 0.82)
        return (*color, alpha)

    return build_grid(24, 16, tail_point, tail_color)


def build_dorsal() -> AttributeBundle:
    def dorsal_func(u: float, v: float) -> Vec3:
        span = 0.34
        height = 0.32
        x = lerp(-0.2, 0.28, u)
        swell = math.sin(u * math.pi) ** 0.8
        y = 0.16 + swell * height * (1 - abs(v - 0.5) * 0.5)
        z = (v - 0.5) * span * (0.55 + (1 - u) * 0.25)
        z += math.sin(v * math.pi) * 0.04 * (1 - u)
        return (x, y, z)

    def dorsal_color(u: float, v: float, pos: Vec3, normal: Vec3) -> Tuple[float, float, float, float]:
        tip = smoothstep(0.2, 1.0, u)
        edge = abs(v - 0.5) * 1.6
        base = (1.0, 0.78, 0.64)
        tip_tint = (1.0, 0.62, 0.82)
        color = tuple(base[i] * (1.0 - tip) + tip_tint[i] * tip for i in range(3))
        alpha = clamp(0.68 - 0.28 * tip - 0.18 * edge, 0.26, 0.78)
        return (*color, alpha)

    return build_grid(14, 8, dorsal_func, dorsal_color)


def build_pectoral_left() -> AttributeBundle:
    def pectoral_func(u: float, v: float) -> Vec3:
        spread = 0.28
        x = lerp(-0.02, 0.32, u)
        y = -0.02 + math.sin(u * math.pi) * 0.08 - v * 0.03
        z = 0.16 + (v - 0.5) * spread
        x += math.sin((v - 0.5) * math.pi) * 0.04
        y += math.sin(u * math.pi * 0.5) * 0.03
        return (x, y, z)

    def pectoral_color(u: float, v: float, pos: Vec3, normal: Vec3) -> Tuple[float, float, float, float]:
        root = smoothstep(0.0, 0.4, u)
        tip = smoothstep(0.35, 1.0, u)
        warm = (1.0, 0.82, 0.68)
        cool = (0.98, 0.64, 0.88)
        edge = abs(v - 0.5) * 1.6
        color = tuple(warm[i] * (1.0 - tip) + cool[i] * tip for i in range(3))
        color = tuple(color[i] * (0.9 + 0.1 * (1.0 - edge)) for i in range(3))
        alpha = clamp(0.68 - 0.3 * tip, 0.2, 0.75)
        return (*color, alpha)

    return build_grid(10, 6, pectoral_func, pectoral_color)


def build_pelvic() -> AttributeBundle:
    def pelvic_func(u: float, v: float) -> Vec3:
        spread = 0.26
        x = lerp(-0.18, 0.06, u)
        y = -0.14 + (1 - u) * -0.06 + (v - 0.5) * 0.02
        z = (v - 0.5) * spread
        y += math.sin(u * math.pi) * 0.05
        return (x, y, z)

    def pelvic_color(u: float, v: float, pos: Vec3, normal: Vec3) -> Tuple[float, float, float, float]:
        tip = smoothstep(0.25, 1.0, u)
        glow = clamp(0.5 + 0.5 * (1.0 - abs(v - 0.5) * 1.4), 0.0, 1.0)
        base = (1.0, 0.78, 0.66)
        tip_tint = (0.96, 0.6, 0.92)
        color = tuple(base[i] * (1.0 - tip) + tip_tint[i] * tip for i in range(3))
        color = tuple(min(1.0, color[i] + 0.08 * glow) for i in range(3))
        alpha = clamp(0.66 - 0.28 * tip, 0.2, 0.72)
        return (*color, alpha)

    return build_grid(8, 6, pelvic_func, pelvic_color)


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
    eye_white = build_eye(0.095, 18, 24)
    eye_pupil = build_eye(0.045, 14, 20)

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
                "baseColorFactor": [1.0, 0.76, 0.62, 1.0],
                "metallicFactor": 0.02,
                "roughnessFactor": 0.42,
            },
            "emissiveFactor": [0.08, 0.04, 0.03],
        },
        {
            "name": "FinMaterial",
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 0.82, 0.78, 0.7],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.55,
            },
            "alphaMode": "BLEND",
            "doubleSided": True,
            "emissiveFactor": [0.06, 0.03, 0.05],
        },
        {
            "name": "EyeWhite",
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 0.99, 0.97, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.35,
            },
            "emissiveFactor": [0.12, 0.12, 0.16],
        },
        {
            "name": "EyePupil",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.08, 0.08, 0.12, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.1,
            },
            "emissiveFactor": [0.03, 0.03, 0.05],
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
            "translation": [0.29, 0.038, 0.132],
        },
        {
            "name": "EyeRightWhite",
            "mesh": 6,
            "translation": [0.29, 0.038, -0.132],
        },
        {
            "name": "EyeLeftPupil",
            "mesh": 7,
            "translation": [0.316, 0.044, 0.145],
            "scale": [0.92, 1.08, 0.92],
        },
        {
            "name": "EyeRightPupil",
            "mesh": 7,
            "translation": [0.316, 0.044, -0.145],
            "scale": [0.92, 1.08, 0.92],
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
