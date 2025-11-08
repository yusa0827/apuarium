"""CPU-side schooling simulation for goldfish."""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Iterable, List, Sequence, Tuple

Vector3 = Tuple[float, float, float]
Matrix3 = Tuple[Tuple[float, float, float], Tuple[float, float, float], Tuple[float, float, float]]


def _vec_add(a: Vector3, b: Vector3) -> Vector3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _vec_sub(a: Vector3, b: Vector3) -> Vector3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _vec_scale(v: Vector3, s: float) -> Vector3:
    return (v[0] * s, v[1] * s, v[2] * s)


def _vec_length(v: Vector3) -> float:
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def _vec_dot(a: Vector3, b: Vector3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _vec_normalize(v: Vector3) -> Vector3:
    length = _vec_length(v)
    if length == 0:
        return (0.0, 0.0, 0.0)
    return (v[0] / length, v[1] / length, v[2] / length)


def _vec_cross(a: Vector3, b: Vector3) -> Vector3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _orientation_from_direction(direction: Vector3) -> Matrix3:
    forward = _vec_normalize(direction)
    up = (0.0, 0.0, 1.0)
    if abs(_vec_dot(up, forward)) > 0.9:
        up = (0.0, 1.0, 0.0)
    right = _vec_normalize(_vec_cross(forward, up))
    up = _vec_normalize(_vec_cross(right, forward))
    return (
        (forward[0], right[0], up[0]),
        (forward[1], right[1], up[1]),
        (forward[2], right[2], up[2]),
    )


@dataclass
class FishState:
    position: Vector3
    velocity: Vector3
    orientation: Matrix3
    scale: float
    phase: float

    def forward(self) -> Vector3:
        return (self.orientation[0][0], self.orientation[1][0], self.orientation[2][0])


class GoldfishSimulator:
    """Simple schooling simulation running entirely on the CPU."""

    def __init__(
        self,
        fish_count: int = 6,
        tank_size: Sequence[float] = (2.6, 1.6, 1.4),
        min_speed: float = 0.25,
        max_speed: float = 0.55,
        turn_rate: float = math.radians(70.0),
        cohesion: float = 0.2,
        separation_distance: float = 0.18,
        separation_strength: float = 0.5,
        surface_damping: float = 0.4,
        rng: random.Random | None = None,
    ) -> None:
        self.fish: List[FishState] = []
        self.tank = tuple(float(x) for x in tank_size)
        self.min_speed = min_speed
        self.max_speed = max_speed
        self.turn_rate = turn_rate
        self.cohesion = cohesion
        self.separation_distance = separation_distance
        self.separation_strength = separation_strength
        self.surface_damping = surface_damping
        self.rng = rng or random.Random()
        for _ in range(fish_count):
            self.fish.append(self._spawn_fish())

    def _spawn_fish(self) -> FishState:
        pos = tuple((self.rng.random() - 0.5) * axis for axis in self.tank)
        heading = _random_direction(self.rng)
        speed = self.rng.uniform(self.min_speed, self.max_speed)
        velocity = _vec_scale(heading, speed)
        orientation = _orientation_from_direction(heading)
        scale = self.rng.uniform(0.8, 1.2)
        phase = self.rng.random() * 2.0 * math.pi
        return FishState(position=pos, velocity=velocity, orientation=orientation, scale=scale, phase=phase)

    def step(self, dt: float) -> None:
        if not self.fish:
            return
        center = (
            sum(f.position[0] for f in self.fish) / len(self.fish),
            sum(f.position[1] for f in self.fish) / len(self.fish),
            sum(f.position[2] for f in self.fish) / len(self.fish),
        )
        updated: List[FishState] = []
        for idx, fish in enumerate(self.fish):
            cohesion_vec = _vec_sub(center, fish.position)
            cohesion_len = _vec_length(cohesion_vec)
            if cohesion_len > 0:
                cohesion_vec = _vec_scale(cohesion_vec, 1.0 / cohesion_len)
            separation_vec = (0.0, 0.0, 0.0)
            for j, other in enumerate(self.fish):
                if j == idx:
                    continue
                diff = _vec_sub(fish.position, other.position)
                dist = _vec_length(diff)
                if 1e-6 < dist < self.separation_distance:
                    separation_vec = _vec_add(separation_vec, _vec_scale(diff, 1.0 / dist))
            desired_dir = _vec_add(fish.velocity, _vec_scale(cohesion_vec, self.cohesion))
            desired_dir = _vec_add(desired_dir, _vec_scale(separation_vec, self.separation_strength))
            desired_dir = _vec_add(desired_dir, _vec_scale(fish.position, -0.1))

            for axis in range(3):
                limit = self.tank[axis] * 0.5
                component = desired_dir[axis]
                pos_axis = fish.position[axis]
                if pos_axis < -limit and component < 0:
                    desired_dir = desired_dir[:axis] + (-0.8 * component,) + desired_dir[axis + 1:]
                elif pos_axis > limit and component > 0:
                    desired_dir = desired_dir[:axis] + (-0.8 * component,) + desired_dir[axis + 1:]

            if fish.position[2] > self.tank[2] * 0.4:
                desired_dir = (
                    desired_dir[0],
                    desired_dir[1],
                    desired_dir[2] - self.surface_damping * abs(desired_dir[2]),
                )

            desired_speed = _vec_length(desired_dir)
            if desired_speed < 1e-6:
                desired_dir = _random_direction(self.rng)
                desired_speed = self.min_speed
            else:
                desired_dir = _vec_scale(desired_dir, 1.0 / desired_speed)
                desired_speed = max(self.min_speed, min(self.max_speed, desired_speed))

            current_dir = _vec_normalize(fish.velocity)
            new_dir = _slerp(current_dir, desired_dir, min(1.0, self.turn_rate * dt))
            new_velocity = _vec_scale(new_dir, desired_speed)
            new_position = _vec_add(fish.position, _vec_scale(new_velocity, dt))
            new_orientation = _orientation_from_direction(new_dir)
            new_phase = (fish.phase + desired_speed * dt * 1.8) % (2.0 * math.pi)
            updated.append(FishState(position=new_position, velocity=new_velocity, orientation=new_orientation,
                                     scale=fish.scale, phase=new_phase))
        self.fish = updated

    def states(self) -> Iterable[FishState]:
        return list(self.fish)


def _random_direction(rng: random.Random) -> Vector3:
    phi = rng.uniform(0.0, 2.0 * math.pi)
    costheta = rng.uniform(-1.0, 1.0)
    sintheta = math.sqrt(max(0.0, 1.0 - costheta * costheta))
    return (math.cos(phi) * sintheta, math.sin(phi) * sintheta, costheta)


def _slerp(a: Vector3, b: Vector3, t: float) -> Vector3:
    dot = max(-1.0, min(1.0, _vec_dot(a, b)))
    if dot > 0.9995:
        blended = _vec_add(_vec_scale(a, 1.0 - t), _vec_scale(b, t))
        return _vec_normalize(blended)
    theta = math.acos(dot)
    sin_theta = math.sin(theta)
    factor_a = math.sin((1.0 - t) * theta) / sin_theta
    factor_b = math.sin(t * theta) / sin_theta
    return _vec_add(_vec_scale(a, factor_a), _vec_scale(b, factor_b))
