#!/usr/bin/env python3
"""Detect whether the current branch merges cleanly with a target branch.

This helper spins up a temporary detached worktree at the current HEAD and
attempts a `git merge --no-commit --no-ff` against the requested branch
(defaults to ``origin/master``).  If Git reports conflicts the script will
surface that fact and exit with a non-zero status so it can be used inside
CI workflows or pre-push hooks.

The script never touches the caller's working tree: any temporary worktree is
discarded once the check completes, regardless of the merge outcome.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def run_git(args: list[str], repo: Path, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    """Run a git command within ``repo`` and return the completed process."""

    completed = subprocess.run(
        ["git", "-C", str(repo), *args],
        text=True,
        capture_output=True,
        check=False,
    )

    if check and completed.returncode != 0:
        raise subprocess.CalledProcessError(completed.returncode, completed.args, completed.stdout, completed.stderr)

    return completed


def ensure_remote_available(target: str, repo: Path) -> tuple[str, str]:
    """Ensure the remote referenced by ``target`` exists and return components.

    Parameters
    ----------
    target:
        The ref given by the user (e.g. ``origin/master``).
    repo:
        Path to the repository root.

    Returns
    -------
    tuple[str, str]
        ``(remote, remote_ref)`` where ``remote`` is the remote name and
        ``remote_ref`` the portion after the first ``/`` (or ``"HEAD"`` if
        absent).
    """

    remote, _, remainder = target.partition("/")
    if not remainder:
        remainder = "HEAD"

    remotes = run_git(["remote"], repo)
    remote_names = {line.strip() for line in remotes.stdout.splitlines() if line.strip()}

    if remote not in remote_names:
        raise RuntimeError(
            f"指定されたリモート '{remote}' が見つかりません。`git remote -v` で確認し、"
            "必要であれば `git remote add` を実行してください。"
        )

    return remote, remainder


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Check whether the current branch merges cleanly with a target ref.")
    parser.add_argument(
        "target",
        nargs="?",
        default="origin/master",
        help="検証したいターゲットブランチ（デフォルト: origin/master）",
    )
    args = parser.parse_args(argv)

    repo = Path(__file__).resolve().parents[1]

    try:
        remote, remote_ref = ensure_remote_available(args.target, repo)
    except RuntimeError as exc:
        print(exc)
        return 2

    fetch = run_git(["fetch", remote], repo, check=False)
    if fetch.returncode != 0:
        print("リモートからの fetch に失敗しました:")
        if fetch.stderr:
            print(fetch.stderr.strip())
        return fetch.returncode

    full_target = f"{remote}/{remote_ref}"
    verify = run_git(["rev-parse", "--verify", full_target], repo, check=False)
    if verify.returncode != 0:
        print(f"{full_target} が確認できませんでした。ブランチ名を見直してください。")
        return verify.returncode

    tmpdir = Path(tempfile.mkdtemp(prefix="merge-check-"))

    try:
        worktree = run_git(["worktree", "add", "--detach", str(tmpdir), "HEAD"], repo, check=False)
        if worktree.returncode != 0:
            print("一時ワークツリーの作成に失敗しました:")
            if worktree.stderr:
                print(worktree.stderr.strip())
            return worktree.returncode

        merge = subprocess.run(
            ["git", "-C", str(tmpdir), "merge", "--no-commit", "--no-ff", full_target],
            text=True,
            capture_output=True,
        )

        # 常に abort して元の状態へ戻す
        subprocess.run(["git", "-C", str(tmpdir), "merge", "--abort"], text=True, capture_output=True)

        if merge.returncode == 0:
            print(f"{full_target} とのマージは自動解決可能です。")
            return 0

        print(f"{full_target} とのマージでコンフリクトが発生しました。出力を確認してください。")
        output = merge.stderr.strip() or merge.stdout.strip()
        if output:
            print(output)
        return 1

    finally:
        run_git(["worktree", "remove", "--force", str(tmpdir)], repo, check=False)
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
