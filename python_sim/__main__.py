"""コマンドラインからシミュレーションを実行するためのエントリポイント。"""
from __future__ import annotations

import argparse

from .simulation import AquariumSimulation


def main() -> None:
    parser = argparse.ArgumentParser(description="金魚の3Dシミュレーションを実行します")
    parser.add_argument("--fish", type=int, default=4, help="水槽内の金魚の数")
    parser.add_argument("--seconds", type=float, default=30.0, help="再生する秒数")
    parser.add_argument("--fps", type=int, default=24, help="アニメーションのフレームレート")
    parser.add_argument("--seed", type=int, default=None, help="乱数シード（再現性確保用）")
    parser.add_argument(
        "--export",
        type=str,
        default=None,
        metavar="PATH",
        help="OBJ ファイルとして金魚モデルを出力し、シミュレーションは実行しません",
    )
    args = parser.parse_args()

    simulation = AquariumSimulation(fish_count=args.fish, seed=args.seed)

    if args.export:
        simulation.export_obj(args.export)
        print(f"OBJ ファイルを {args.export} に出力しました。")
        return

    simulation.run(seconds=args.seconds, fps=args.fps)


if __name__ == "__main__":
    main()
