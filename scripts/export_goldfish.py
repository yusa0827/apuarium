"""Generate a goldfish OBJ file using the procedural mesh generator."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from aquarium3d.goldfish import GoldfishParameters, generate_goldfish_mesh


def export_obj(output: Path) -> None:
    mesh = generate_goldfish_mesh(GoldfishParameters())
    output.write_text(mesh.to_obj(), encoding="utf-8")
    print(f"Exported goldfish mesh to {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, nargs="?", default=Path("assets/goldfish.obj"))
    args = parser.parse_args()
    export_obj(args.output)
