# dsh-rtk-rewrite

[![CI](https://github.com/afrijaldz/dsh-rtk-rewrite/actions/workflows/ci.yml/badge.svg)](https://github.com/afrijaldz/dsh-rtk-rewrite/actions/workflows/ci.yml)

A DeepSeek Harness profile plugin that routes supported shell commands through
[RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) before they run, so their output reaches
the model compressed.

```
git status        ->  rtk git status
cargo test        ->  rtk cargo test
pytest -q         ->  rtk pytest -q
```

The model still writes ordinary commands. The plugin rewrites them at dispatch time, so no prompt
change and no per-command prefixing is needed.

## Requirements

- DeepSeek Harness with the `tools` service (every shipped profile).
- [RTK](https://github.com/rtk-ai/rtk) 1.0.1 or newer, either on `PATH`, in `RTK_BIN`, or named by
  the `rtkPath` option. Verify with `rtk gain` — the savings dashboard, not a "command not found".
- Node.js 20+ (DSH bundles one).

## Install

### Recommended: Plugin Manager

Point `install_bundle` at an absolute checkout of this repository:

```json
{
  "action": "install_bundle",
  "target": "/absolute/path/to/dsh-rtk-rewrite"
}
```

The manager copies the package into the profile, selects it as a bundle, and activates it. Restart
the app if the result reports `restart-required`.

### CLI

```bash
dsh plugin --profile desktop add /absolute/path/to/dsh-rtk-rewrite
```

Then add the package to `dsh.profile.bundles` in the profile's `package.json` if it is not selected
automatically.

### Manual

Copy this directory into `~/.dsh/profiles/<profile>/node_modules/dsh-rtk-rewrite`, add a row to the
profile patch, and declare the package in `dependencies`:

```yaml
- insert:
    - id: rtk-rewrite
      name: dsh-rtk-rewrite
```

## Configuration

Override the row's `config` in your profile's `cordis.patch.yml`:

```yaml
- id: rtk-rewrite
  name: dsh-rtk-rewrite
  config:
    rtkPath: C:\tools\rtk\rtk.exe
    dataDir: C:\tools\rtk-data
    timeoutMs: 1500
```

| Option | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Set `false` to disable without uninstalling |
| `rtkPath` | auto | Explicit path to the `rtk` executable |
| `dataDir` | RTK default | Keep RTK's database, config, recall and tee files under this directory |
| `timeoutMs` | `1500` | Per-rewrite time limit; timeouts pass the command through |
| `cacheSize` | `500` | Remembered rewrites before the cache resets |
| `commands` | `[]` | Extra first tokens to rewrite |
| `exclude` | `[]` | First tokens to never rewrite |

`dataDir` matters inside sandboxes that only permit writes under one directory: RTK otherwise
stores state in `%LOCALAPPDATA%\rtk` on Windows, which such a sandbox denies.

## Windows notes

Only commands whose first token is a known development CLI are rewritten (git, gh, cargo, go,
dotnet, docker, kubectl, pytest, npm, pnpm, and similar). Unix file utilities are deliberately
excluded: PowerShell aliases `ls`, `cat` and `rm`, so rewriting `ls` to `rtk ls` would replace a
working command with one that needs a native `ls` binary, which Windows does not have.

RTK's `tree` filter is also unreliable on Windows because it passes Unix flags to `tree.com`.

## Behaviour

- Hooks the `tools/execute` waterfall (the same extension point the shipped timeout policy uses)
  and replaces `exec.arguments.command`; validation and presentation are untouched.
- Skips multi-line scripts, commands already starting with `rtk`, and escalated calls
  (`sandbox_permissions`), whose exact command the user approved.
- Fails open: a missing binary, timeout, or malformed output leaves the command unchanged.
- Caches rewrites per command string.

## Verify

```bash
rtk gain        # command count and savings grow once rewrites happen
```

A `git status` run by the agent should come back compact rather than as the full
"On branch ... nothing to commit, working tree clean" block.

## Uninstall

Remove the bundle through Plugin Manager, or delete the package from the profile's `node_modules`,
its `dependencies` entry, and the `rtk-rewrite` row from `cordis.patch.yml`. Restart the app.

## Development

```bash
npm test
```

The suite covers the allowlist policy and the RTK runner using an injected `execFile`, so it needs
neither RTK nor a shell.

## License

MIT — see [LICENSE](LICENSE).
