import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const runsDir = 'runs'; // read-only fixtures
const tmp = mkdtempSync(join(tmpdir(), 'rig-runs-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight(runsDir, '2026-10-28');
  const row = (job: string) => night?.rows.find((r) => r.job === job);

  it('reads 5 jobs, sorted by job, and counts the 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night?.night).toBe('2026-10-28');
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night?.badLines).toBe(1);
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('fixtures/refresh: 3 retries, last ok, times as logged', () => {
    expect(row('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('notes/backup: fail with "quota exceeded"', () => {
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded', runs: 1 });
  });

  it('digest/render: owner null keeps the row', () => {
    expect(row('digest/render')).toMatchObject({ owner: null, lastStatus: 'ok', runs: 1 });
  });
});

describe('readNight edge cases', () => {
  it('returns null when the night has no file', () => {
    expect(readNight(tmp, '2026-01-01')).toBeNull();
  });

  it('an empty file is a night with no rows', () => {
    writeFileSync(join(tmp, '2026-01-02.jsonl'), '');
    expect(readNight(tmp, '2026-01-02')).toEqual({
      night: '2026-01-02',
      rows: [],
      counts: { ok: 0, retry: 0, fail: 0 },
      badLines: 0,
    });
  });

  it('counts lines with missing fields or unknown status as bad', () => {
    writeFileSync(
      join(tmp, '2026-01-03.jsonl'),
      [
        '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok","owner":"x"}',
        '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"maybe","owner":"x"}',
        '{"job":"a","status":"ok","owner":"x"}',
        '[1,2]',
        'not json',
        '',
      ].join('\n'),
    );
    const night = readNight(tmp, '2026-01-03');
    expect(night?.rows).toHaveLength(1);
    expect(night?.badLines).toBe(4);
  });

  it('rejects nights that are not YYYY-MM-DD', () => {
    expect(readNight(tmp, '../runs/2026-10-28')).toBeNull();
    expect(readNight(runsDir, '2026-10-28.jsonl')).toBeNull();
    expect(readNight(runsDir, '')).toBeNull();
  });
});
