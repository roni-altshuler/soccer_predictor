# Pre-Commit Setup Guide

This project uses pre-commit hooks to automatically format and lint Python code according to PEP 8 standards before each commit.

## Installation

1. **Install pre-commit and formatting tools:**

```bash
pip install pre-commit black flake8 isort
```

2. **Install the git hook scripts:**

```bash
pre-commit install
```

## What Happens on Commit

When you run `git commit`, the following checks will run automatically:

1. **Black** - Auto-formats Python code to PEP 8 style
2. **Flake8** - Lints code for style violations and errors
3. **isort** - Sorts and organizes import statements
4. **General Checks** - Trailing whitespace, file endings, YAML/JSON validation, etc.

If any check fails, the commit will be blocked and files will be auto-fixed where possible.

## Manual Running

You can run all hooks on all files manually:

```bash
pre-commit run --all-files
```

Or on specific files:

```bash
pre-commit run --files backend/main.py scripts/train_league_models.py
```

## Skip Hooks (Not Recommended)

If you absolutely need to skip the hooks for a commit:

```bash
git commit --no-verify -m "Your commit message"
```

## Configuration

The pre-commit configuration is in `.pre-commit-config.yaml`. Key settings:

- **Line length**: 88 characters (Black default)
- **Python version**: 3.12
- **Excluded directories**: `.venv`, `node_modules`, `__pycache__`, etc.

## Updating Hooks

To update all hooks to their latest versions:

```bash
pre-commit autoupdate
```

## Uninstalling

To remove pre-commit hooks:

```bash
pre-commit uninstall
```

## Tools Used

### Black

- **Purpose**: Opinionated code formatter
- **Style**: PEP 8 compliant
- **Website**: https://black.readthedocs.io/

### Flake8

- **Purpose**: Linter for style guide enforcement
- **Checks**: PEP 8, pyflakes, McCabe complexity
- **Website**: https://flake8.pycqa.org/

### isort

- **Purpose**: Import statement organizer
- **Profile**: black (compatible with Black formatting)
- **Website**: https://pycqa.github.io/isort/

## Common Issues

### Issue: `ImportError: cannot import name 'soft_unicode' from 'markupsafe'`

**Solution**: Update MarkupSafe

```bash
pip install --upgrade MarkupSafe
```

### Issue: Hooks are slow

**Solution**: Hooks only run on changed files by default. Use `--all-files` sparingly.

### Issue: Black and flake8 conflict

**Solution**: Our config already handles this with `--extend-ignore=E203,W503` in flake8.

## Best Practices

1. **Commit often** - Smaller commits = faster hook execution
2. **Review auto-fixes** - Always check what Black changed before pushing
3. **Fix flake8 warnings** - Don't ignore linting errors
4. **Keep hooks updated** - Run `pre-commit autoupdate` monthly

## Example Workflow

```bash
# Make your changes
vim backend/prediction_service.py

# Stage your changes
git add backend/prediction_service.py

# Commit - hooks run automatically
git commit -m "feat: improve scoreline prediction logic"

# If hooks fail, they'll auto-fix and you need to re-stage
git add backend/prediction_service.py
git commit -m "feat: improve scoreline prediction logic"

# Push
git push
```
