[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/einsteincy/csv-reader-speed-01-entry/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/einsteincy/csv-reader-speed-01-entry/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# csv-reader-speed-01-entry

A faster drop-in for make.fun's own csv-reader 1.0.0, for the
[Read broken CSV files faster](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
bounty. `solve.js` is an original ES module whose `run(input)` returns exactly
the answer csv-reader 1.0.0 returns for every input — same `{columns, rows,
errors}`, same broken-row policy (BOM, stray CR, quoted fields, doubled
quotes, quote junk, unterminated quotes, short/long rows) — but reads the text
with a hybrid scan instead of one character at a time: clean records go
through one slice + `String.split(',')`, and only records holding a quote or a
stray CR take the careful reader, which itself works with `indexOf`/`slice`.

`main.ts` is the kit's own driver (unchanged): it reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`. It turns V8's incremental marking off before importing
`solve.js`, as the house baseline does.

## Test locally

```sh
# practice set, entry vs expected (needs the kit unpacked next to this repo)
MAKEFUN_INPUT_DIR=<kit>/practice/input \
MAKEFUN_OUTPUT_DIR=/tmp/csv-out \
node main.ts

# score it with the kit's scorer
MAKEFUN_OUTPUT_DIR=/tmp/csv-out \
MAKEFUN_REFERENCE_DIR=<kit>/practice/reference \
MAKEFUN_SCORES_DIR=/tmp/csv-scores \
node <kit>/program/scorer/main.ts
```

## Files

- `solve.js` — the parser (original work, dependency-free ES module).
- `main.ts` — the harness driver from the kit.
- `LICENSE` — MIT.
