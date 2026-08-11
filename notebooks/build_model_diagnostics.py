"""Generate `notebooks/model_diagnostics.ipynb`.

The notebook is the visual counterpart to the diagnostics artifacts: the
classifier sweep, what the trees actually leaned on, an actual tree drawn out,
the calibration curve, and — first, because everything else is unreadable
without it — where the ceiling is in this sport.

Written as a generator rather than by hand so the notebook can be regenerated
and re-executed when the numbers move, instead of drifting into a snapshot of
whatever was true the day someone saved it.

    python3 notebooks/build_model_diagnostics.py
    jupyter nbconvert --to notebook --execute --inplace notebooks/model_diagnostics.ipynb
"""
from __future__ import annotations

import nbformat as nbf
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "notebooks" / "model_diagnostics.ipynb"

nb = nbf.v4.new_notebook()
cells = []

md = lambda s: cells.append(nbf.v4.new_markdown_cell(s.strip()))  # noqa: E731
code = lambda s: cells.append(nbf.v4.new_code_cell(s.strip()))  # noqa: E731

md("""
# Model diagnostics

Tree ensembles over rating features, swept across configurations, with the
importances and an actual tree drawn out — the approach Green Code applies to
Wimbledon in [`jdlamstein/tennispredictor`](https://github.com/jdlamstein/tennispredictor).

**Read the ceiling section first.** Every accuracy number below is meaningless
without it, and the headline result of this notebook is a ceiling, not a model.
""")

md("""
## 1. The ceiling, and why a tennis accuracy does not transfer

A tennis match has two outcomes and one player per side. A soccer match has
three, and a quarter of them end level.

| | tennis | soccer |
|---|---|---|
| outcomes | 2 | 3, and 25.6% are draws |
| the unit | one player, one rating | eleven players, rotation, injuries |
| favourite / home wins | ~70% | 43.0% |

So the honest question is not "can we reach 83%" but "what does the best
forecaster in the world reach on this problem". That forecaster is the closing
line — thousands of bettors and professional syndicates, with team news, money
flow and their own models. On our corpus it reaches **54.0%**.

If an 83%-accurate soccer model existed, the bookmakers pricing these matches
would be insolvent.

There *is* a fair comparison to a tennis number, though: strip the draws out and
ask only which side is stronger. That is the binary question tennis asks, and on
it this model answers correctly **70.3%** of the time against the closing
line's 72.6%.
""")

code("""
import json, sys
from pathlib import Path
ROOT = Path.cwd().parent if Path.cwd().name == 'notebooks' else Path.cwd()
sys.path.insert(0, str(ROOT))

ladder = json.loads((ROOT / 'backend/data/diagnostics/baseline_ladder.json').read_text())
import pandas as pd
df = pd.DataFrame(ladder['ladder'])[['label', 'note', 'accuracy', 'brier', 'n']]
df['accuracy'] = (df['accuracy'] * 100).round(1)
print(f"scored on {ladder['n']:,} priced Wave A matches since {ladder['method']['since']}\\n")
df
""")

code("""
import matplotlib.pyplot as plt
import numpy as np

fig, ax = plt.subplots(figsize=(8, 3.2))
lab = [e['label'] for e in ladder['ladder'] if e['accuracy'] is not None]
val = [e['accuracy'] * 100 for e in ladder['ladder'] if e['accuracy'] is not None]
colors = ['#555' if 'This model' not in l else '#e63946' for l in lab]
bars = ax.barh(lab, val, color=colors, height=0.55)
for b, v in zip(bars, val):
    ax.text(v + 0.4, b.get_y() + b.get_height()/2, f'{v:.1f}%', va='center', fontsize=10)
ax.set_xlim(0, 62)
ax.axvline(83, color='#999', ls=':', lw=1)
ax.text(83, -0.75, ' 83% — not reachable in a\\n three-way sport where the\\n market itself gets 54%',
        fontsize=8, color='#777', va='top')
ax.set_xlabel('winner picked correctly (%)')
ax.set_title('Where the model sits — and where 83% would be', loc='left')
ax.spines[['top', 'right']].set_visible(False)
plt.tight_layout(); plt.show()
""")

md("""
## 2. The features

Pi-ratings (Constantinou & Fenton 2013), built strictly forward — a match
updates the ratings only *after* its features are recorded — plus ClubElo read
as of the last publication before kickoff.
""")

code("""
import sqlite3
from backend.scripts.benchmark_pi_ratings import load_matches, build_pi_features, WAVE_A

conn = sqlite3.connect(f"file:{ROOT}/backend/data/warehouse.sqlite?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
rows = load_matches(conn, WAVE_A)
X, y, _ = build_pi_features(rows)
print(f"{len(rows):,} completed Wave A matches, {X.shape[1]} rating features")

names = ['pi_home_at_home','pi_home_away','pi_away_at_home','pi_away_away',
         'pi_matchup','pi_home_mean','pi_away_mean','pi_expected_gd']
pd.DataFrame(X, columns=names).describe().T[['mean','std','min','max']].round(3)
""")

code("""
# Does the headline feature separate the three outcomes at all?
fig, ax = plt.subplots(figsize=(7, 3))
for k, lab_, c in [(0,'home win','#2a9d8f'), (1,'draw','#e9c46a'), (2,'away win','#e76f51')]:
    ax.hist(X[y==k, 4], bins=60, alpha=.55, label=f'{lab_} (n={(y==k).sum():,})',
            density=True, color=c)
ax.set_xlabel("pi_matchup  (home side's home rating − away side's away rating)")
ax.set_ylabel('density'); ax.legend(frameon=False, fontsize=9)
ax.set_title('One feature, three outcomes', loc='left')
ax.spines[['top','right']].set_visible(False)
plt.tight_layout(); plt.show()

for k, lab_ in [(0,'home win'),(1,'draw'),(2,'away win')]:
    print(f"  mean pi_matchup on {lab_:<9}: {X[y==k,4].mean():+.3f}")
""")

md("""
## 3. The sweep

Sixteen configurations across HistGradientBoosting, RandomForest and XGBoost.

**The guard matters more than the grid.** Searching many configurations and
reporting the winner is how a sweep manufactures a result — with enough
candidates, something wins on noise. So the search runs on *selection* seasons
only, and the winner is scored once on *final* seasons it was never chosen on.
The gap between those two numbers is the cost of the search.
""")

code("""
sweep = json.loads((ROOT / 'backend/data/diagnostics/classifier_sweep.json').read_text())
cand = pd.DataFrame(sweep['candidates']).sort_values('selection_brier')
best = sweep['best']
print(f"selection seasons {sweep['method']['selection_seasons']}  ->  "
      f"final holdout {sweep['method']['final_seasons']} (never searched on)\\n")
print(f"best config        : {best['config']}")
print(f"  selection Brier  : {best['selection_brier']:.5f}")
print(f"  FINAL Brier      : {best['final_brier']:.5f}   accuracy {best['final_accuracy']:.1%}")
print(f"  cost of the search: {best['search_cost_brier']:+.5f}")
cand.head(16)
""")

code("""
fig, ax = plt.subplots(figsize=(8, 4.5))
c = cand.sort_values('selection_brier', ascending=False)
fam = ['#457b9d' if n.startswith('hgb') else '#e63946' if n.startswith('xgb') else '#588157'
       for n in c['config']]
ax.barh(c['config'], c['selection_brier'], color=fam, height=.6)
ax.set_xlim(min(c['selection_brier'])-0.004, max(c['selection_brier'])+0.002)
ax.axvline(best['final_brier'], color='#111', ls='--', lw=1.2,
           label=f"winner on the final holdout ({best['final_brier']:.4f})")
ax.set_xlabel('Brier on selection seasons (lower is better)')
ax.set_title('Sixteen configurations, one honest number', loc='left')
ax.legend(frameon=False, fontsize=9, loc='lower right')
ax.spines[['top','right']].set_visible(False)
plt.tight_layout(); plt.show()
""")

md("""
## 4. What the trees actually leaned on

Permutation importance on held-out seasons, not gini on the training data. Gini
importance is biased toward high-cardinality continuous features and is measured
where the model was fitted, so it reports what a tree *used* rather than what
actually helps out of sample. With correlated rating features that is a
meaningful difference.
""")

code("""
imp = pd.DataFrame(sweep['permutation_importance'])
fig, ax = plt.subplots(figsize=(7.5, 4))
i = imp.sort_values('importance')
ax.barh(i['feature'], i['importance'], xerr=i['std'],
        color=['#e63946' if v == i['importance'].max() else '#8d99ae' for v in i['importance']],
        height=.6, error_kw=dict(lw=.8, ecolor='#555'))
ax.set_xlabel('permutation importance (higher = removing it hurts more)')
ax.set_title('One feature carries almost all of it', loc='left')
ax.spines[['top','right']].set_visible(False)
plt.tight_layout(); plt.show()
imp
""")

md("""
`pi_matchup` dominates by an order of magnitude, and `pi_expected_gd` scores
exactly zero — it is an algebraic duplicate of `pi_matchup` (penaltyblog defines
expected goal difference as the home side's home rating minus the away side's
away rating), so permuting one copy changes nothing while the other still
carries the signal.

That is the finding worth taking away: **the signal in this feature set is
essentially one number.** Ten more rating features buy nothing measurable, which
is exactly why six goal models, two Bayesian models, pi-ratings and sixteen tree
configurations all land within .003 Brier of each other.
""")

md("""
## 5. An actual tree

One tree from the forest, depth-limited so it is legible. This is the "visualise
the trees" step — useful less as a model artifact than as a sanity check that
the splits are on the features and thresholds you would expect.
""")

code("""
from sklearn.ensemble import RandomForestClassifier
from sklearn.tree import plot_tree
import numpy as np

seasons = np.array([int(r['season'] or 0) for r in rows])
tr = np.flatnonzero(seasons < 2024)
rf = RandomForestClassifier(n_estimators=200, min_samples_leaf=60, max_depth=3,
                            n_jobs=-1, random_state=17).fit(X[tr], y[tr])

fig, ax = plt.subplots(figsize=(17, 7))
plot_tree(rf.estimators_[0], feature_names=names, class_names=['home','draw','away'],
          filled=True, rounded=True, fontsize=8, impurity=True, proportion=True, ax=ax)
ax.set_title('One tree from the forest (depth 3), with Gini impurity at each node', loc='left')
plt.tight_layout(); plt.show()
""")

md("""
## 6. Calibration — the part that is actually good

The pick is barely better than picking the higher-rated side. The *probability*
is the product: when the model says 70%, it happens about 70% of the time.
""")

code("""
cal = pd.DataFrame(ladder['calibration'])
cal['stated_mid'] = (cal['stated_low'] + cal['stated_high']) / 2

fig, ax = plt.subplots(figsize=(5.4, 5.2))
ax.plot([30, 90], [30, 90], ls='--', color='#aaa', lw=1, label='perfect calibration')
ax.scatter(cal['stated_mid'], cal['observed'] * 100,
           s=cal['n'] / 6, color='#e63946', zorder=3, alpha=.85)
for _, r in cal.iterrows():
    ax.annotate(f"n={int(r['n']):,}", (r['stated_mid'], r['observed'] * 100),
                textcoords='offset points', xytext=(8, -4), fontsize=8, color='#666')
ax.set_xlabel('model says (%)'); ax.set_ylabel('actually happened (%)')
ax.set_title('Calibration', loc='left'); ax.legend(frameon=False, fontsize=9)
ax.spines[['top','right']].set_visible(False)
plt.tight_layout(); plt.show()
cal[['stated_low','stated_high','n','observed']]
""")

md("""
## 7. Verdict

| challenger | Brier | vs Dixon-Coles |
|---|---|---|
| Dixon-Coles (serving) | .5879 | — |
| pi-ratings + gradient boosting | .5882 | +.0003, not significant |
| best of 16 swept tree configs | see above | no better |
| six penaltyblog goal models | within .003 of each other | — |
| Bayesian / hierarchical Bayesian | within .001 | — |

Five independent attempts, one answer: **the model family is not the
bottleneck.** The sweep's own importances say why — the feature set collapses to
roughly one number, and no classifier extracts more signal than the number
contains.

The two things being added now are the ones that are genuinely new information
rather than new arithmetic on the same information: **starting lineups** (which
the closing line prices within minutes of team news, and which this project had
zero rows of) and **line movement** (opening price versus close, which makes
closing line value measurable for the first time).
""")

nb["cells"] = cells
nb.metadata["kernelspec"] = {"display_name": "Python 3", "language": "python", "name": "python3"}
OUT.parent.mkdir(parents=True, exist_ok=True)
nbf.write(nb, OUT)
print(f"wrote {OUT} ({len(cells)} cells)")
