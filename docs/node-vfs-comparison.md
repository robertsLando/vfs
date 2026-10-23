# Comparison with `node:vfs`

Node.js now ships its own virtual file system as `node:vfs`. This page lists
what each one supports, so you can tell whether you can switch. The main
consumer is [pkg](https://github.com/yao-pkg/pkg)'s SEA mode, so the first
section answers that question directly.

Checked on 2026-10-23 against:

- **this package**: v0.3.3 (`main`), on Node.js 22.23.2
- **`node:vfs`**: Node.js v26.12.1 with `--experimental-vfs`, plus the
  [API docs](https://github.com/nodejs/node/blob/main/doc/api/vfs.md) on Node's
  `main` branch

Most "Yes"/"No" cells were run with a probe script against both, not read off
the docs. Rows marked _(docs)_ come from the Node.js docs or source only.

## Can pkg drop this package for `node:vfs`?

Not yet. pkg's SEA runtime (`prelude/sea-vfs-setup.js` and
`prelude/sea-bootstrap-core.js` on pkg `main`) relies on these:

| What pkg does | Works with `node:vfs`? |
|---|---|
| Loads `node:vfs` first and falls back to this package | Today yes: without the flag, `require('node:vfs')` throws `ERR_UNKNOWN_BUILTIN_MODULE`, so the fallback runs. **Breaks once a release ships `node:vfs` unflagged**: pkg will pick core and hit the next row |
| `virtualFs.mount('/snapshot', { overlay: true })`, then every path, `__dirname`, `process.pkg` and `insideSnapshot()` assumes `/snapshot` | **No.** Core ignores the prefix and mounts at `/dev/null/vfs/<n>`; `/snapshot/...` is not found. pkg would need to use the returned mount point everywhere, or move to SEA `"useVfs"` / `"vfsArchive"` |
| `SEAProvider extends MemoryProvider` and overrides `readFileSync`, `statSync`, `readdirSync`, `existsSync`, `readlinkSync` | Yes. Core calls the same provider methods |
| Windows: wraps `VirtualFileSystem.prototype.shouldHandle` and `resolvePath` | **No.** Neither is on core's prototype, so the wrapper calls `undefined`. Core handles Windows paths itself, so the patch should be dropped, not ported |
| `fs.openSync` / `readSync` / `closeSync` / `fstatSync` on packaged files ([pkg#302](https://github.com/yao-pkg/pkg/issues/302)) | Yes. Here it needs [#4](https://github.com/robertsLando/vfs/pull/4) |
| Writes, `fs.promises.open`, `createWriteStream`, `opendir` on packaged paths | Yes. Not supported here |
| Native addons: pkg patches `process.dlopen` to extract them | Core loads `.node` files from the VFS itself _(docs)_, so pkg's patch becomes optional |
| Worker threads: pkg wraps `Worker` and re-runs the VFS setup inside it | Still needed. A mount made with `vfs.mount()` is not visible in a worker (reading it fails with `ENOTDIR`) |
| Node.js versions pkg targets in SEA mode: 22+ | **No.** Core needs 26.4+, and the flag until the unflag lands in a release |

What has to happen before pkg can switch:

1. A Node.js release with `node:vfs` unflagged ([nodejs/node#66318](https://github.com/nodejs/node/pull/66318) is on `main` only).
2. pkg stops hard-coding `/snapshot` and uses the path `mount()` returns, or SEA `"useVfs"`.
3. pkg drops its Windows `shouldHandle`/`resolvePath` patch on the core path.
4. pkg keeps this package as the fallback until it drops every Node.js version below the one that ships (1).

Until (2) is done, pkg's `require('node:vfs')`-first fallback should be
changed to prefer this package, or it will break on the first Node.js
release that loads `node:vfs` without a flag.

## Summary

- `node:vfs` covers the whole `fs` surface after mount, writes included. This
  package only routes reads through the global `fs`. Writes, `fs.openSync` and
  friends, and `fs.promises.open` fall through to the real disk.
- `node:vfs` mounts under a reserved path (`/dev/null/vfs/<n>`) picked at
  runtime. You cannot mount at a path you choose, and there is no overlay mode
  or virtual working directory. Code that relies on `mount('/app')`, `overlay`
  or `virtualCwd` has no direct equivalent.
- `node:vfs` needs Node.js 26.4+ and the `--experimental-vfs` flag in every
  release so far. The flag is gone on Node's `main`
  ([nodejs/node#66318](https://github.com/nodejs/node/pull/66318)) but not
  released yet. This package runs on Node.js 22+.
- `SqliteProvider` exists only here. `ZipProvider` and `ComposableProvider`
  exist only in `node:vfs`.

## Availability

| | This package | `node:vfs` |
|---|---|---|
| Node.js version | 22+ | 26.4+ |
| Needs a flag | No | `--experimental-vfs` in all releases up to v26.12.1. Unflagged on `main`, unreleased |
| Import | `require('@roberts_lando/vfs')` | `require('node:vfs')`; emits an `ExperimentalWarning` |

## Mounting

| Feature | This package | `node:vfs` |
|---|---|---|
| Mount at a chosen path, e.g. `mount('/app')` | Yes | No. `mount()` returns a path under `/dev/null/vfs/`; an argument is ignored |
| Overlay mode (VFS files shadow real ones, the rest falls through) | Yes, `create({ overlay: true })` | No. A mount never shadows a real path. `ComposableProvider([memory, new RealFSProvider(dir)])` layers providers inside one mount instead |
| Virtual working directory (`process.cwd()` / `process.chdir()`) | Yes, `create({ virtualCwd: true })`. Relative `fs` paths do not follow it | No. `process.chdir()` into a mount fails with `ENOTDIR` |
| `vfs-mount` / `vfs-unmount` events on `process` | Yes | No |
| `vfs.shouldHandle(path)` | Yes | Not documented |
| `vfs.mountPoint`, `vfs.mounted`, `vfs.unmount()` | Yes | Yes |
| `vfs.mountPointURL` | No | Yes |
| `vfs.vfsBase()` and a readable root listing every mount | No | Yes |
| `using` / `Symbol.dispose` | Yes | Yes |
| Mount from the command line: `--vfs-mount`, `--vfs-load` _(docs)_ | No | Yes |
| `vfs.registerProvider()` for `--vfs-load` _(docs)_ | No | Yes |
| Single Executable Applications with `"useVfs": true` _(docs)_ | No | Yes |

## Providers

| Provider | This package | `node:vfs` |
|---|---|---|
| `MemoryProvider`, `setReadOnly()` | Yes | Yes |
| `RealFSProvider` | Yes. Containment is lexical, so a symlink inside the root can point outside it | Yes. Symlinks that resolve outside the root are rejected _(docs)_ |
| `SqliteProvider` (`node:sqlite`, in memory or on disk) | Yes | No |
| `ZipProvider` (`zlib.ZipBuffer` / `zlib.ZipFile`) | No | Yes |
| `ComposableProvider` (layered providers, copy-on-write) | No | Yes |
| Custom providers extending `VirtualProvider` | Yes | Yes |

## Instance API (`vfs.*`)

| Feature | This package | `node:vfs` |
|---|---|---|
| Read, write, mkdir, rmdir, unlink, rename, copyFile, symlink, readlink, realpath, access, exists, stat, lstat | Yes | Yes |
| `openSync` / `readSync` / `closeSync` / `fstatSync` and callback forms | Yes | Yes |
| `writeSync` / `write`, `ftruncate` | No | Yes |
| `rm`, `truncate`, `link`, `chmod`, `chown`, `lchown`, `utimes`, `lutimes` | No | Yes |
| `mkdtemp`, `opendir`, `openAsBlob` | No | Yes |
| `mkstemp` | No | Only on Node's `main`, not in v26.12.1 |
| Callback forms | `readFile`, `writeFile`, `stat`, `lstat`, `readdir`, `realpath`, `readlink`, `access`, `open`, `close`, `read`, `fstat` | All of those plus `write`, `rm`, `truncate`, `link`, `mkdtemp`, `opendir`. Neither has `mkdir`, `unlink`, `rename`, `copyFile` or `symlink` callbacks |
| `createReadStream` | Yes | Yes |
| `createWriteStream` | No | Yes |
| `watch`, `watchFile`, `unwatchFile` | Yes | Yes |
| `readdir(path, { recursive: true })` | No, nested entries are missing ([platformatic/vfs#4](https://github.com/platformatic/vfs/issues/4)) | Yes |
| `stat(path, { bigint: true })` | No, returns Number fields ([#5](https://github.com/robertsLando/vfs/pull/5)) | Yes |
| `glob` / `globSync` | No ([platformatic/vfs#12](https://github.com/platformatic/vfs/issues/12)) | No |
| `vfs.promises` | `readFile`, `writeFile`, `appendFile`, `stat`, `lstat`, `readdir`, `mkdir`, `rmdir`, `unlink`, `rename`, `copyFile`, `realpath`, `readlink`, `symlink`, `access`, `watch` | All of those plus `open`, `rm`, `truncate`, `link`, `mkdtemp`, `chmod`, `chown`, `lchown`, `lchmod`, `utimes`, `lutimes` |

## Through the global `fs` and module loader, once mounted

This is where the two differ most. This package replaces functions on the `fs`
module object. `node:vfs` dispatches from inside `fs` itself, so it also
catches references taken before the mount:

```js
const { readFileSync } = require('node:fs'); // captured before mount
vfs.mount('/app');
readFileSync('/app/a.txt'); // this package: ENOENT. node:vfs (at its mount point): works
```

| Feature | This package | `node:vfs` |
|---|---|---|
| `require()` and `import` | Yes. `Module.registerHooks()` on 23.5+, plus `Module._resolveFilename` / `Module._extensions` patches | Yes |
| Module cache cleared on `unmount()` | No. Remounting new content at the same path returns the old module | Yes |
| Native addons (`.node`) loaded from the VFS _(docs)_ | No | Yes |
| `ffi.dlopen()` of a library in the VFS _(docs)_ | No | Yes |
| Sync reads: `readFileSync`, `statSync`, `lstatSync`, `readdirSync`, `existsSync`, `realpathSync`, `readlinkSync`, `accessSync` | Yes | Yes |
| Callback reads: `readFile`, `stat`, `lstat`, `readdir`, `readlink`, `realpath`, `access` | Yes | Yes |
| `fs.promises` reads: same list | Yes | Yes |
| Writes: `writeFile`, `appendFile`, `mkdir`, `rm`, `rmdir`, `unlink`, `rename`, `copyFile`, `symlink`, `mkdtemp`, … (all three forms) | No. They go to the real disk, which usually fails with `ENOENT` because the mount path does not exist there | Yes |
| `fs.openSync` / `readSync` / `closeSync` / `fstatSync` and callback forms | No ([#3](https://github.com/robertsLando/vfs/issues/3), fixed by [#4](https://github.com/robertsLando/vfs/pull/4)) | Yes |
| `fs.promises.open()` returning a `FileHandle` | No | Yes |
| `fs.createReadStream` | Yes | Yes |
| `fs.createWriteStream` | No | Yes |
| `fs.opendir` / `fs.opendirSync` | No | Yes |
| `fs.watch`, `fs.watchFile`, `fs.unwatchFile` | Yes | Yes |
| `fs.globSync` / `fs.promises.glob` | Yes, with an absolute pattern or a `cwd` inside the mount | Only with `cwd` inside the mount. An absolute pattern under the mount point returns `[]` |
| `fs.statSync(path, { bigint: true })` | No, returns Number fields ([#5](https://github.com/robertsLando/vfs/pull/5)) | Yes |
| `fs.readdirSync(path, { recursive: true })` | No, nested entries are missing | Yes |

## Upstream

[platformatic/vfs](https://github.com/platformatic/vfs) has since aligned with
`node:vfs` in [platformatic/vfs#74](https://github.com/platformatic/vfs/pull/74):
it dropped `mount(prefix)` and added recursive reads and more `fs` dispatch.
This fork has not pulled that change, so the tables above describe the older
`mount(prefix)` API.
