# 📚 Documentation

This directory contains all project documentation for the Soccer Match Predictor application.

## 🧭 Start here — the handbook

**[handbook/](./handbook/README.md)** is the user-facing documentation the app
itself links to: tutorials, the concepts behind every number on the site, and a
reference for the API, the artifacts and the commands.

| | |
|---|---|
| [Getting started](./handbook/getting-started.md) | What each page answers, in one screen |
| [Tutorials](./handbook/README.md#tutorials) | Read a forecast, follow a season, read a bracket, judge the model |
| [Scoring](./handbook/concepts/scoring.md) | Brier, log loss, ECE, calibration, and the floors |
| [Models](./handbook/concepts/models.md) | The four forecasters and what each was measured against |
| [Evaluation](./handbook/concepts/evaluation.md) | Walk-forward vs live, and why they stay apart |
| [Data](./handbook/concepts/data.md) | Sources, coverage, and what is genuinely missing |
| [HTTP API](./handbook/reference/api.md) · [Artifacts](./handbook/reference/artifacts.md) · [Commands](./handbook/reference/cli.md) | Reference |
| [Glossary](./handbook/glossary.md) | One line per term |

Everything below is internal: architecture, operations and project history.

## 📖 Contents

### Project Organization

- **[REPOSITORY_ORGANIZATION.md](./REPOSITORY_ORGANIZATION.md)** - Repository structure and organization guide

### Setup & Configuration

- **[PRECOMMIT_SETUP.md](./PRECOMMIT_SETUP.md)** - Pre-commit hooks configuration and setup guide
- **[frontend-interface-setup.md](./frontend-interface-setup.md)** - Frontend interface setup instructions

### Deployment & Operations

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Deployment guide for Vercel and production environments
- **[AUTO_UPDATE_SCHEDULING.md](./AUTO_UPDATE_SCHEDULING.md)** - Automated update scheduling documentation

### Development Guides

- **[RETRAINING_GUIDE.md](./RETRAINING_GUIDE.md)** - Machine learning model retraining procedures
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - Common issues and solutions

### Architecture

- **[ARCHITECTURE_V2.md](./ARCHITECTURE_V2.md)** - Full system architecture documentation

### Project History

- **[BUILD_SUMMARY.md](./BUILD_SUMMARY.md)** - Initial project build process log
- **[COMPLETION_REPORT.md](./COMPLETION_REPORT.md)** - Requirements completion checklist
- **[UPDATE_SUMMARY.md](./UPDATE_SUMMARY.md)** - Summary of project updates and changes
- **[UX_IMPROVEMENTS_SUMMARY.md](./UX_IMPROVEMENTS_SUMMARY.md)** - User experience improvements and design changes

## 🔗 Quick Links

- [Main README](../README.md) - Project overview and getting started
- [Backend](../backend/) - FastAPI backend code
- [Frontend](../src/) - Next.js frontend code
- [Scripts](../scripts/) - Utility scripts

## 📝 Contributing

When adding new documentation:

1. Place it in this directory
2. Update this README with a link and brief description
3. Follow the existing markdown formatting conventions
4. Use clear, descriptive filenames
