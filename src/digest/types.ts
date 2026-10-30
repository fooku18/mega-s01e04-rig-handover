// The night's run log, one row per job. Reader: readNight in src/digest/.
export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null; // null in the log; rendered as `—`
  runs: number; // lines for this job
  retries: number; // lines with status `retry`
  lastStatus: RunStatus;
  lastError: string | null; // `error` of the last line, if it had one
  firstAt: string; // `at` as in the log, offset kept
  lastAt: string;
};

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job; empty file = []
  counts: Record<RunStatus, number>; // lines per status, for the board link
  badLines: number; // lines that didn't parse; counted, never thrown
};

// null = no runs/<night>.jsonl (404). An empty file is a Night with no rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;
