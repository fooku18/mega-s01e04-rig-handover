import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { Night } from '../src/digest/types.js';
import { lane } from '../src/lane.js';

// Fixtures are written to a temp runs dir; runs/ is read-only and never touched.
const tmp = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const config: RigConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: tmp,
};
const app = createApp(config);

const FILE = '2026-10-28'; // a night with a file
const BAD = '2026-10-29'; // same rows plus one line that doesn't parse
const EMPTY = '2026-10-30'; // a file with nothing in it
const MISSING = '2026-01-01'; // no file

const CLEAN_LINES = [
  '{"at":"2026-10-28T23:00:02+01:00","job":"rig/rotate-logs","status":"ok","owner":"lane-07"}',
  '{"at":"2026-10-28T23:00:06+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  '{"at":"2026-10-29T00:00:04+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  '{"at":"2026-10-29T01:30:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
  '{"at":"2026-10-29T01:31:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
  '{"at":"2026-10-29T01:33:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
  '{"at":"2026-10-29T01:37:00+01:00","job":"fixtures/refresh","status":"ok","owner":"rook"}',
  '{"at":"2026-10-29T02:00:03+01:00","job":"sync/mirror","status":"retry","owner":"rook","error":"lock held"}',
  '{"at":"2026-10-29T02:00:13+01:00","job":"sync/mirror","status":"retry","owner":"rook","error":"lock held"}',
  '{"at":"2026-10-29T02:00:33+01:00","job":"sync/mirror","status":"ok","owner":"rook"}',
  '{"at":"2026-10-29T04:00:01+01:00","job":"notes/backup","status":"fail","owner":"lane-07","error":"quota exceeded"}',
  '{"at":"2026-10-29T05:41:09+01:00","job":"digest/render","status":"ok","owner":null}',
];
const TRUNCATED_LINE = '{"at":"2026-10-29T05:59:58+01:00","job":"lane/sy';

// Jobs in the order both the page and the JSON must list them (sorted by job).
const JOBS = ['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs', 'sync/mirror'];
// Flagged by plan 2d: retries >= 3 (fixtures/refresh) or last status fail (notes/backup).
const WARN = ['fixtures/refresh', 'notes/backup'];

// Table rows in page order. Only body rows match: the header row holds <th>, not <td>.
function pageRows(html: string): { job: string; warn: boolean }[] {
  return [...html.matchAll(/<tr(?: class="([^"]*)")?><td>([^<]*)<\/td>/g)].map((m) => ({
    job: m[2],
    warn: m[1] === 'warn',
  }));
}

let savedMarker: string | undefined;

beforeAll(() => {
  writeFileSync(join(tmp, `${FILE}.jsonl`), CLEAN_LINES.join('\n') + '\n');
  writeFileSync(join(tmp, `${BAD}.jsonl`), [...CLEAN_LINES, TRUNCATED_LINE].join('\n') + '\n');
  writeFileSync(join(tmp, `${EMPTY}.jsonl`), '');
  savedMarker = process.env.LANE_MARKER;
  process.env.LANE_MARKER = 'DIGEST-ROUTES-TEST';
});

afterAll(() => {
  if (savedMarker === undefined) delete process.env.LANE_MARKER;
  else process.env.LANE_MARKER = savedMarker;
});

describe('GET /digest/:night', () => {
  it('200 for a night with a file: lane banner, one row per job, flagged rows warn', async () => {
    const res = await app.request(`/digest/${FILE}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(lane().id);
    expect(html).toContain('DIGEST-ROUTES-TEST');
    expect(html).toContain(`digest · ${FILE}`);
    expect(pageRows(html).map((r) => r.job)).toEqual(JOBS);
    expect(pageRows(html).filter((r) => r.warn).map((r) => r.job)).toEqual(WARN);
  });

  it('404 for a night with no file', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    const html = await res.text();
    expect(res.status).toBe(404);
    expect(html).toContain('no run log for that night');
  });

  it('empty night: 200, "nothing ran", no table', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
  });

  it('bad line: 200, shows the bad-line note, other rows intact', async () => {
    const res = await app.request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 line in the log could not be read');
    expect(pageRows(html).map((r) => r.job)).toEqual(JOBS);
  });
});

describe('GET /api/digest/:night', () => {
  it('200 for a night with a file: the rows, one per job, with no bad lines', async () => {
    const res = await app.request(`/api/digest/${FILE}`);
    const body = (await res.json()) as Night;
    expect(res.status).toBe(200);
    expect(body.night).toBe(FILE);
    expect(body.rows.map((r) => r.job)).toEqual(JOBS);
    expect(body.badLines).toBe(0);
    expect(body.counts).toEqual({ ok: 6, retry: 5, fail: 1 });
  });

  it('404 for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log for that night' });
  });

  it('empty night: 200 with rows []', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    const body = (await res.json()) as Night;
    expect(res.status).toBe(200);
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('bad line: 200 with badLines 1, other rows intact', async () => {
    const res = await app.request(`/api/digest/${BAD}`);
    const body = (await res.json()) as Night;
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(JOBS);
  });
});

describe('page and JSON agree', () => {
  it.each([FILE, BAD, EMPTY])('%s: same jobs in the same order', async (night) => {
    const html = await (await app.request(`/digest/${night}`)).text();
    const body = (await (await app.request(`/api/digest/${night}`)).json()) as Night;
    expect(pageRows(html).map((r) => r.job)).toEqual(body.rows.map((r) => r.job));
  });
});
