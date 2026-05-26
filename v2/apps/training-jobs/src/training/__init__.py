"""training-jobs: one-shot K8s GPU jobs.

Not a long-running service — entrypoints invoked by Temporal-triggered
K8s Jobs. The unified PyTorch trainer ports from
soccer_predictor/backend/scripts/train_unified.py in the next phase.
"""

__version__ = "0.1.0"


def main() -> int:
    print("training-jobs scaffold: see docs/STATUS.md for what is wired.")
    return 0
