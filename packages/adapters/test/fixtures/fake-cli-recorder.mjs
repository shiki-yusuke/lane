#!/usr/bin/env node
// Test double for tracker-github.test.ts / vcs-github.test.ts: records the argv it was
// invoked with, so a test can assert exactly which command line an adapter built without
// ever touching a real GitHub repo or git remote.
//
// - If FAKE_CLI_RECORD_FILE is set, appends one JSON line (the argv array) to that file —
//   this is how a test inspects what the *adapter itself* invoked (as opposed to calling
//   the recorder directly, which would only prove the recorder works).
// - Exits 0 unless FAKE_CLI_EXIT_CODE is set.
// - If FAKE_CLI_STDOUT is set, prints that verbatim on stdout (used to simulate a real
//   command's own stdout, e.g. `gh pr create`'s printed PR URL).
import { appendFileSync } from "node:fs";

const argv = process.argv.slice(2);
if (process.env.FAKE_CLI_RECORD_FILE) {
  appendFileSync(process.env.FAKE_CLI_RECORD_FILE, `${JSON.stringify(argv)}\n`);
}
if (process.env.FAKE_CLI_STDOUT) {
  console.log(process.env.FAKE_CLI_STDOUT);
}
process.exit(process.env.FAKE_CLI_EXIT_CODE ? Number(process.env.FAKE_CLI_EXIT_CODE) : 0);
