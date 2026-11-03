# Schematic checker benchmark

This benchmark measures the real in-process schematic checking path through `packages/cli/src/check.ts`. It is a performance probe, not a semantic corpus case, so its generated projects stay outside `examples/cases/`.

## Run

```bash
bun run bench:schematic -- --shape all --sizes 32,128,512,2048 --json
```

Options:

- `--shape all|sparse|fanout` selects one workload shape or both.
- `--sizes N,N,...` selects instance counts; each value must be at least 2.
- `--repeats N` sets timed checks per case.
- `--warmups N` sets untimed checks before timing.
- `--json` emits machine-readable results.
- `--keep` retains generated projects instead of deleting them.

The default is `all`, sizes `128,512,2048`, three timed checks, and one warm-up.

## Workloads

| Shape | Instances | Nets | Connectivity |
| --- | ---: | ---: | --- |
| `sparse-ring` | `N` | `N` | Every net has two resistor-pin members; the nets form a ring. |
| `high-fanout` | `N` | 2 | Every resistor contributes one pin to `BUS` and one pin to `RETURN`. |

Each project uses deterministic `ID` values, the current reference resistor component, and the reference symbol and footprint. The project and schematic sources are generated under `/tmp/texteda-schematic-bench-*`. They are removed by default; `--keep` reports the retained path.

## Measurement scope

For every shape and size, the parent process creates one project and starts a fresh Bun worker. The worker:

1. runs `analyzeProject()` and rejects any error diagnostic or unexpected instance/net count;
2. performs the requested warm-up checks;
3. measures only warm `checkProject()` elapsed time with a monotonic clock;
4. rejects any timed check that produces an error diagnostic.

A separate worker per case keeps process high-water RSS comparable between cases. Reported peak RSS includes Bun startup and module loading; it is not an allocation-only measurement. Generation, file copying, process startup, and the initial validation are excluded from the timed samples.

The regression test `packages/cli/test/benchmark-schematic.test.ts` runs the generator without asserting timing. It checks deterministic source generation, expected dimensions, and zero error diagnostics for both shapes.

## Baseline

The baseline below was collected with Bun 1.4.2 on Linux x64, `--repeats 3`, and `--warmups 1`. Every case reported zero errors and zero warnings; each reported three notes from the normal checker path.

| Shape | Instances | Nets | Max fan-out | Schematic bytes | Median ms | Peak RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| sparse-ring | 32 | 32 | 2 | 2,063 | 0.938 | 72.6 |
| sparse-ring | 128 | 128 | 2 | 8,323 | 2.102 | 75.2 |
| sparse-ring | 512 | 512 | 2 | 34,435 | 8.536 | 101.7 |
| sparse-ring | 2,048 | 2,048 | 2 | 143,079 | 19.918 | 138.1 |
| high-fanout | 32 | 2 | 32 | 1,925 | 0.997 | 71.8 |
| high-fanout | 128 | 2 | 128 | 7,684 | 2.411 | 73.2 |
| high-fanout | 512 | 2 | 512 | 31,684 | 7.382 | 93.7 |
| high-fanout | 2,048 | 2 | 2,048 | 131,211 | 33.902 | 119.2 |

A larger probe reached 16,384 instances with zero errors: sparse-ring median `142.407 ms` at `342.5 MiB` peak RSS; high-fanout median `1,142.925 ms` at `298.6 MiB`. These observations are baselines only. They do not establish a hard performance limit or an asymptotic complexity guarantee.

PCB benchmarking is intentionally deferred.
