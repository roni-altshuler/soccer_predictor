"""Offline current-season checks: denied/partial input must not replace good data."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

import httpx
import pytest
import yaml

from backend.scripts import ingest_fbref_schedules as ingest
from backend.scripts.record_schedule_refresh import record
from backend.services.fbref.routine_schedule import SCOPE, refresh

NOW = datetime(2026, 10, 10, 10, tzinfo=timezone.utc)
ROOT = Path(__file__).resolve().parents[2]


def database(path, now=NOW):
    with sqlite3.connect(path) as db:
        db.executescript(ingest.SCHEMA)
        for comp, league in SCOPE.items():
            start = now.year if comp == 'usa.1' or now.month >= 7 else now.year - 1
            season = str(start) if comp == 'usa.1' else f'{start}-{start + 1}'
            url = f'https://fbref.com/en/comps/9/{comp}/{season}/schedule/test'
            db.execute('INSERT INTO fbref_seasons VALUES (?,?,?,?,?,?,?)',
                       (league, season, url, url, 1, '2026-09-01T10:00:00+00:00', None))
            db.execute('INSERT INTO fbref_fixtures VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       (league, season, 'old-key', None, f'{start}-10-12', '1', None,
                        '12:00', 'Home', 'Away', None, None, None, None, None, None, None))
        db.execute('INSERT INTO fbref_seasons VALUES (?,?,?,?,?,?,?)',
                   ('France Ligue 1', '2010-2011', 'historic', None, 0, 'old', None))


def page(*, day='2026-10-13', home='Home', duplicate=False):
    row = f'<tr><td data-stat="date">{day}</td><td data-stat="home_team">{home}</td><td data-stat="away_team">Away</td><td data-stat="score"></td></tr>'
    return f'<html><body class="fb"><table>{row * (2 if duplicate else 1)}</table>{" " * 21000}</body></html>'


def run(path, handler, now=NOW):
    calls, waits = [], []
    def wrapped(request):
        calls.append(str(request.url))
        return handler(request, len(calls))
    result = refresh(path, now=now, transport=httpx.MockTransport(wrapped), sleep=waits.append)
    return result, calls, waits


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_success_checks_six_pages_replaces_postponed_keys_and_preserves_history(tmp_path):
    path = tmp_path / 'fbref.sqlite'
    database(path)
    report, calls, waits = run(path, lambda *_: httpx.Response(200, text=page()))
    assert report['state'] == 'checked'
    assert len(calls) == report['requests'] == report['request_limit'] == 6
    assert len(waits) == 5 and all(5 < wait <= 6 for wait in waits)
    assert all('/history/' not in url for url in calls)
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM fbref_fixtures').fetchone()[0] == 6
        assert db.execute('SELECT DISTINCT date FROM fbref_fixtures').fetchall() == [('2026-10-13',)]
        assert db.execute("SELECT scraped_at FROM fbref_seasons WHERE season='2010-2011'").fetchone()[0] == 'old'
        assert db.execute('SELECT COUNT(*) FROM fbref_seasons WHERE scraped_at=?', (NOW.isoformat(),)).fetchone()[0] == 6
    assert all(r['last_verified_at'] == NOW.isoformat() for r in report['leagues'])


def test_production_verification_is_stamped_after_requests_not_before(tmp_path, monkeypatch):
    path = tmp_path / 'fbref.sqlite'
    database(path)
    finished = NOW + timedelta(minutes=2)
    times = iter([NOW, finished])
    class Clock(datetime):
        @classmethod
        def now(cls, _tz=None): return next(times)
    monkeypatch.setattr('backend.services.fbref.routine_schedule.datetime', Clock)
    result = refresh(path, transport=httpx.MockTransport(lambda _: httpx.Response(200, text=page())), sleep=lambda _: None)
    assert result['state'] == 'checked' and result['attempted_at'] == finished.isoformat()
    assert all(r['last_verified_at'] == finished.isoformat() for r in result['leagues'])
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT DISTINCT scraped_at FROM fbref_seasons WHERE fixtures=1').fetchall() == [(finished.isoformat(),)]


@pytest.mark.parametrize('status', [403, 429, 500, 302])
def test_denied_or_redirected_page_stops_without_retry_and_preserves_bytes(tmp_path, status):
    path = tmp_path / 'fbref.sqlite'
    database(path)
    before = digest(path)
    report, calls, waits = run(path, lambda _, n: httpx.Response(status if n == 2 else 200, text=page()))
    assert report['state'] == 'degraded' and report['reason'] == f'http_{status}'
    assert len(calls) == 2 and len(waits) == 1
    assert digest(path) == before
    assert all(r['last_verified_at'] == '2026-09-01T10:00:00+00:00' for r in report['leagues'])


@pytest.mark.parametrize('html', [page(home='Other'), page(duplicate=True), page(day='tomorrow'), page(day='2027-10-13'),
                                  '<table></table>', '<title>Just a moment...</title>' + ' ' * 21000])
def test_partial_invalid_or_challenged_schedule_never_reports_success(tmp_path, html):
    path = tmp_path / 'fbref.sqlite'
    database(path)
    before = digest(path)
    report, calls, _ = run(path, lambda *_: httpx.Response(200, text=html))
    assert report['state'] == 'degraded' and len(calls) == 1
    assert digest(path) == before


def test_transport_failure_and_missing_input_do_not_create_or_replace_database(tmp_path):
    path = tmp_path / 'fbref.sqlite'
    report, calls, _ = run(path, lambda *_: pytest.fail('no network for missing input'))
    assert report['state'] == 'degraded' and not path.exists() and calls == []
    database(path)
    before = digest(path)
    def unavailable(request, _):
        raise httpx.ReadTimeout('timed out', request=request)
    report, calls, _ = run(path, unavailable)
    assert report['reason'] == 'transport_unavailable' and len(calls) == 1
    assert digest(path) == before


@pytest.mark.parametrize('now', [datetime(2026, 1, 10, tzinfo=timezone.utc), NOW])
def test_current_scope_uses_calendar_mls_and_european_season_boundaries(tmp_path, now):
    path = tmp_path / 'fbref.sqlite'
    database(path, now)
    day = '2026-03-13' if now.month == 1 else '2026-10-13'
    report, calls, _ = run(path, lambda *_: httpx.Response(200, text=page(day=day)), now)
    assert report['state'] == 'checked' and len(calls) == 6
    european = '2025-2026' if now.month == 1 else '2026-2027'
    assert {r['season'] for r in report['leagues'] if r['competition_id'] != 'usa.1'} == {european}
    assert report['leagues'][-1]['season'] == '2026'


@pytest.mark.parametrize('change', ['missing', 'foreign_url'])
def test_scope_metadata_is_validated_before_any_request(tmp_path, change):
    path = tmp_path / 'fbref.sqlite'
    database(path)
    with sqlite3.connect(path) as db:
        if change == 'missing': db.execute("DELETE FROM fbref_seasons WHERE league='USA MLS'")
        else: db.execute("UPDATE fbref_seasons SET schedule_url='https://example.com/private' WHERE league='USA MLS'")
    before = digest(path)
    report, calls, _ = run(path, lambda *_: pytest.fail('invalid input must not fetch'))
    assert report['state'] == 'degraded' and calls == [] and digest(path) == before


def test_routine_cli_does_not_import_optional_scraper_or_browser(tmp_path, monkeypatch):
    path, report_path = tmp_path / 'fbref.sqlite', tmp_path / 'report.json'
    database(path)
    monkeypatch.setattr(ingest, 'DB', path)
    monkeypatch.setitem(sys.modules, 'ScraperFC', None)
    monkeypatch.setitem(sys.modules, 'botasaurus', None)
    monkeypatch.setattr('backend.services.fbref.routine_schedule.refresh',
                        lambda p: run(p, lambda *_: httpx.Response(403))[0])
    assert ingest.main(['--routine', '--report', str(report_path)]) == 1
    assert json.loads(report_path.read_text())['reason'] == 'http_403'


@pytest.mark.parametrize('extra', [[], ['--current-season'], ['--leagues', 'all'], ['--refresh']])
def test_routine_requires_report_and_refuses_scrape_modes(tmp_path, extra):
    args = ['--routine'] if not extra else ['--routine', '--report', str(tmp_path / 'r'), *extra]
    with pytest.raises(SystemExit) as exc: ingest.main(args)
    assert exc.value.code == 2


@pytest.mark.parametrize('content', [None, '{broken', '{}', '{"state":"checked","schema_version":1}'])
def test_failed_or_missing_report_is_published_as_degraded(tmp_path, content):
    path, output = tmp_path / 'report', tmp_path / 'status.json'
    if content is not None: path.write_text(content)
    output.write_text('{"state":"checked"}')
    result = record(path, 'failure', output)
    assert result['state'] == 'degraded' and result['requests'] is None
    assert json.loads(output.read_text()) == result


def test_report_publication_keeps_dates_and_missing_report_keeps_prior_verification(tmp_path):
    db, path, output = tmp_path / 'fbref.sqlite', tmp_path / 'report', tmp_path / 'status.json'
    database(db)
    checked, _, _ = run(db, lambda *_: httpx.Response(200, text=page()))
    path.write_text(json.dumps(checked))
    assert record(path, 'success', output)['leagues'] == checked['leagues']
    path.unlink()
    failed = record(path, 'failure', output)
    assert failed['state'] == 'degraded' and failed['leagues'] == checked['leagues']
    assert failed['requests'] is None
    assert record(path, 'failure', output)['leagues'] == checked['leagues']


def test_inconsistent_success_is_degraded_instead_of_certifying_zero_checks(tmp_path):
    db, path, output = tmp_path / 'fbref.sqlite', tmp_path / 'report', tmp_path / 'status.json'
    database(db)
    checked, _, _ = run(db, lambda *_: httpx.Response(200, text=page()))
    checked['requests'] = 0
    path.write_text(json.dumps(checked))
    assert record(path, 'success', output)['state'] == 'degraded'


def recorder_cli(tmp_path, report, outcome, *, fail_write=False):
    source = tmp_path / 'report.json'
    source.write_text(json.dumps(report))
    output = tmp_path / 'status.json'
    env = {**os.environ, 'GITHUB_RUN_ID': 'current-run',
           'GITHUB_OUTPUT': str(tmp_path / 'step-output'),
           'GITHUB_STEP_SUMMARY': str(tmp_path / 'step-summary')}
    command = [sys.executable, '-m', 'backend.scripts.record_schedule_refresh']
    if fail_write:
        # Run the real entry point with only the atomic replacement failing.
        wrapper = ("from unittest.mock import patch; import runpy\n"
                   "with patch('backend.scripts.record_schedule_refresh.os.replace', "
                   "side_effect=PermissionError('synthetic status write denied')):\n"
                   "    runpy.run_module('backend.scripts.record_schedule_refresh', run_name='__main__')")
        command = [sys.executable, '-c', wrapper]
    return subprocess.run([*command, '--report', str(source), '--outcome', outcome,
                           '--output', str(output)], cwd=ROOT, env=env,
                          capture_output=True, text=True)


@pytest.mark.parametrize('state', ['checked', 'degraded'])
def test_successful_current_status_generation_is_independent_of_check_state(tmp_path, state):
    db = tmp_path / 'fbref.sqlite'
    database(db)
    report, _, _ = run(db, lambda *_: httpx.Response(200, text=page()))
    report.update(state=state, requests=6 if state == 'checked' else 1)
    result = recorder_cli(tmp_path, report, 'success' if state == 'checked' else 'failure')
    assert result.returncode == 0, result.stderr
    written = json.loads((tmp_path / 'status.json').read_text())
    assert written['state'] == state and written['workflow_run'] == 'current-run'
    assert (tmp_path / 'step-output').read_text() == f'state={state}\n'
    assert ('::warning::' in result.stdout) == (state == 'degraded')


def test_inconsistent_success_cli_records_degradation_for_final_failure_gate(tmp_path):
    result = recorder_cli(tmp_path, {}, 'success')
    assert result.returncode == 0, result.stderr
    assert json.loads((tmp_path / 'status.json').read_text())['state'] == 'degraded'
    assert (tmp_path / 'step-output').read_text() == 'state=degraded\n'


@pytest.mark.parametrize('state', ['checked', 'degraded'])
def test_recorder_write_failure_preserves_prior_checked_status_and_blocks_publication(tmp_path, state):
    db = tmp_path / 'fbref.sqlite'
    database(db)
    previous, _, _ = run(db, lambda *_: httpx.Response(200, text=page()))
    previous['workflow_run'] = 'previous-run'
    output = tmp_path / 'status.json'
    output.write_text(json.dumps(previous))
    forecast, snapshots = tmp_path / 'forecast.json', tmp_path / 'snapshots.csv'
    forecast.write_text('{"generated_at":"previous-run"}')
    snapshots.write_text('previous snapshot\n')
    for args in [['init', '-q'], ['add', output.name, forecast.name, snapshots.name],
                 ['-c', 'user.name=Offline probe', '-c', 'user.email=probe@example.invalid',
                  'commit', '-qm', 'synthetic prior publication']]:
        subprocess.run(['git', *args], cwd=tmp_path, capture_output=True, check=True)
    before = {p: p.read_bytes() for p in [output, forecast, snapshots]}
    report = {**previous, 'state': state, 'attempted_at': (NOW + timedelta(days=1)).isoformat()}
    if state == 'checked':
        report['leagues'] = [{**row, 'last_verified_at': report['attempted_at']} for row in report['leagues']]
    else:
        report['requests'] = 1
    result = recorder_cli(tmp_path, report, 'success' if state == 'checked' else 'failure', fail_write=True)
    assert result.returncode != 0 and 'synthetic status write denied' in result.stderr
    assert all(p.read_bytes() == data for p, data in before.items())
    assert not (tmp_path / 'step-output').exists()
    # Reproduce why staging a required filename alone was insufficient.
    staged = subprocess.run(['git', 'add', output.name], cwd=tmp_path, capture_output=True)
    assert staged.returncode == 0
    steps = yaml.safe_load((ROOT / '.github/workflows/season_forecast.yml').read_text())['jobs']['forecast']['steps']
    status = next(s for s in steps if s.get('id') == 'schedule_status')
    assert not status.get('continue-on-error') and 'if' not in status
    # These steps use GitHub's default success() prerequisite, so a failed
    # recorder cannot replace the last-good forecast or release history.
    for name in ['Generate season forecast', 'Record what this forecast said',
                 'Publish snapshot table', 'Commit refreshed forecast']:
        step = next(s for s in steps if s.get('name') == name)
        assert steps.index(status) < steps.index(step)
        assert 'if' not in step and not step.get('continue-on-error')


def test_workflow_bounds_refresh_and_exposes_failure_after_publication():
    workflow = yaml.safe_load((ROOT / '.github/workflows/season_forecast.yml').read_text())
    steps = workflow['jobs']['forecast']['steps']
    schedule = next(s for s in steps if s.get('id') == 'schedule')
    status = next(s for s in steps if s.get('id') == 'schedule_status')
    commit = next(s for s in steps if s.get('name') == 'Commit refreshed forecast')
    final = steps[-1]
    assert '--routine --report /tmp/schedule-refresh.json' in schedule['run']
    assert '--current-season --stale-days' not in schedule['run']
    assert schedule['continue-on-error'] and schedule['timeout-minutes'] == 12
    assert 'steps.schedule.outcome' in status['run']
    assert not status.get('continue-on-error')
    assert 'season_refresh_status.json' in commit['run']
    assert 'git add backend/data/predictions/season_refresh_status.json\n' in commit['run']
    assert steps.index(schedule) < steps.index(status) < steps.index(commit) < steps.index(final)
    assert 'always()' in final['if'] and 'steps.schedule.outcome' in final['if'] and 'steps.schedule_status.outcome' in final['if']
    assert "steps.schedule_status.outputs.state == 'degraded'" in final['if']
    assert not final.get('continue-on-error') and 'exit 1' in final['run']
    import ast
    tree = ast.parse((ROOT / 'backend/scripts/forecast_season.py').read_text())
    served = next(ast.literal_eval(node.value) for node in tree.body
                  if isinstance(node, ast.AnnAssign) and getattr(node.target, 'id', None) == 'LEAGUES')
    assert set(SCOPE) == set(served)
    for name in ['Download forecast inputs', 'Refresh current-season results',
                 'Verify the corpus is the one the published metrics describe', 'Generate season forecast',
                 'Record what this forecast said', 'Publish snapshot table']:
        assert not next(s for s in steps if s.get('name') == name).get('continue-on-error')
