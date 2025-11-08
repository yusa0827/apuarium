"""Run the CPU-based 3D aquarium using Matplotlib."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from aquarium3d import AquariumRenderer, GoldfishSimulator, generate_goldfish_mesh


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fish", type=int, default=6, help="Number of goldfish to simulate")
    parser.add_argument("--seconds", type=float, default=30.0, help="Duration of the animation")
    parser.add_argument("--fps", type=int, default=24, help="Frames per second")
    parser.add_argument("--save", type=str, default="", help="Optional path to save the animation (mp4/gif)")
    args = parser.parse_args()

    mesh = generate_goldfish_mesh()
    simulator = GoldfishSimulator(fish_count=args.fish)
    renderer = AquariumRenderer(mesh, simulator)
    save_path = args.save or None
    renderer.animate(seconds=args.seconds, fps=args.fps, save_path=save_path)


if __name__ == "__main__":
    main()
