'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { create } = require('../index.js');

// These tests verify that the module hooks patch real fs/fs.promises methods
// so that require('fs').readFileSync, require('fs/promises').readFile, etc.
// transparently serve VFS content.

describe('Module hooks — fs sync patches', () => {
  let vfs;

  afterEach(() => {
    if (vfs?.mounted) {
      vfs.unmount();
    }
  });

  it('fs.readFileSync reads from VFS', () => {
    vfs = create();
    vfs.writeFileSync('/data.txt', 'hello from vfs');
    vfs.mount('/vfs-test-sync-read');

    const content = fs.readFileSync('/vfs-test-sync-read/data.txt', 'utf8');
    assert.strictEqual(content, 'hello from vfs');
  });

  it('fs.existsSync returns true for VFS files', () => {
    vfs = create();
    vfs.writeFileSync('/exists.txt', 'yes');
    vfs.mount('/vfs-test-sync-exists');

    assert.strictEqual(fs.existsSync('/vfs-test-sync-exists/exists.txt'), true);
    assert.strictEqual(fs.existsSync('/vfs-test-sync-exists/nope.txt'), false);
  });

  it('fs.statSync returns stats for VFS files', () => {
    vfs = create();
    vfs.writeFileSync('/stat.txt', 'data');
    vfs.mount('/vfs-test-sync-stat');

    const stats = fs.statSync('/vfs-test-sync-stat/stat.txt');
    assert.ok(stats.isFile());
  });

  it('fs.lstatSync returns stats for VFS files', () => {
    vfs = create();
    vfs.writeFileSync('/lstat.txt', 'data');
    vfs.mount('/vfs-test-sync-lstat');

    const stats = fs.lstatSync('/vfs-test-sync-lstat/lstat.txt');
    assert.ok(stats.isFile());
  });

  it('fs.readdirSync lists VFS directory contents', () => {
    vfs = create();
    vfs.writeFileSync('/dir/a.txt', 'a');
    vfs.writeFileSync('/dir/b.txt', 'b');
    vfs.mount('/vfs-test-sync-readdir');

    const entries = fs.readdirSync('/vfs-test-sync-readdir/dir');
    assert.deepStrictEqual(entries.sort(), ['a.txt', 'b.txt']);
  });

  it('fs.realpathSync resolves VFS paths', () => {
    vfs = create();
    vfs.writeFileSync('/real.txt', 'data');
    vfs.mount('/vfs-test-sync-realpath');

    const resolved = fs.realpathSync('/vfs-test-sync-realpath/real.txt');
    assert.strictEqual(resolved, '/vfs-test-sync-realpath/real.txt');
  });

  it('fs.accessSync does not throw for existing VFS files', () => {
    vfs = create();
    vfs.writeFileSync('/access.txt', 'data');
    vfs.mount('/vfs-test-sync-access');

    assert.doesNotThrow(() => fs.accessSync('/vfs-test-sync-access/access.txt'));
  });

  it('fs.accessSync throws ENOENT for missing VFS files', () => {
    vfs = create();
    vfs.mount('/vfs-test-sync-access-miss');

    assert.throws(() => fs.accessSync('/vfs-test-sync-access-miss/nope.txt'), {
      code: 'ENOENT',
    });
  });

  it('fs.readlinkSync reads VFS symlinks', () => {
    vfs = create();
    vfs.writeFileSync('/link-target.txt', 'data');
    vfs.symlinkSync('/link-target.txt', '/my-link.txt');
    vfs.mount('/vfs-test-sync-readlink');

    const target = fs.readlinkSync('/vfs-test-sync-readlink/my-link.txt');
    assert.strictEqual(target, '/vfs-test-sync-readlink/link-target.txt');
  });

  it('fs.lstatSync and fs.readlinkSync see a dangling symlink', () => {
    // existsSync follows the link, so pre-checking with it hides exactly the case
    // lstat and readlink exist for
    vfs = create();
    vfs.symlinkSync('/nowhere.txt', '/dangling.txt');
    vfs.mount('/vfs-test-sync-dangling');

    const stats = fs.lstatSync('/vfs-test-sync-dangling/dangling.txt');
    assert.ok(stats.isSymbolicLink());
    assert.strictEqual(
      fs.readlinkSync('/vfs-test-sync-dangling/dangling.txt'),
      '/vfs-test-sync-dangling/nowhere.txt',
    );
    assert.throws(
      () => fs.statSync('/vfs-test-sync-dangling/dangling.txt'),
      (err) => err.code === 'ENOENT',
    );
  });

  it('fs.readlinkSync raises EINVAL for a path that is not a link', () => {
    // Answering readlink through realpathSync could not tell a link from an
    // ordinary file, so every existing path looked like a self-pointing link.
    vfs = create();
    vfs.writeFileSync('/plain.txt', 'data');
    vfs.mount('/vfs-test-sync-readlink-einval');

    assert.throws(
      () => fs.readlinkSync('/vfs-test-sync-readlink-einval/plain.txt'),
      { code: 'EINVAL' },
    );
  });

  it('fs.readlinkSync returns a relative link body verbatim', () => {
    // POSIX readlink answers the link body; only an absolute target names a
    // provider path that has to be mapped into the mounted namespace.
    vfs = create();
    vfs.mkdirSync('/dir', { recursive: true });
    vfs.writeFileSync('/dir/target.txt', 'data');
    vfs.symlinkSync('./target.txt', '/dir/rel-link.txt');
    vfs.mount('/vfs-test-sync-readlink-rel');

    assert.strictEqual(
      fs.readlinkSync('/vfs-test-sync-readlink-rel/dir/rel-link.txt'),
      './target.txt',
    );
  });

  it('fs.lstatSync describes the link, not its target', () => {
    // lstat used to share findVFSForFsStat, which calls statSync and so
    // followed the link — isSymbolicLink() was never true inside a VFS.
    vfs = create();
    vfs.writeFileSync('/lstat-target.txt', 'data');
    vfs.symlinkSync('/lstat-target.txt', '/lstat-link.txt');
    vfs.mount('/vfs-test-sync-lstat');

    const lstats = fs.lstatSync('/vfs-test-sync-lstat/lstat-link.txt');
    assert.strictEqual(lstats.isSymbolicLink(), true);
    assert.strictEqual(lstats.isFile(), false);

    const stats = fs.statSync('/vfs-test-sync-lstat/lstat-link.txt');
    assert.strictEqual(stats.isSymbolicLink(), false);
    assert.strictEqual(stats.isFile(), true);
  });

  it("fs.readlinkSync maps the target for encoding 'buffer' too", () => {
    // A provider that honours options answers a Buffer, and the mount mapping
    // has to see through it or those callers get the provider-relative path.
    vfs = create();
    vfs.writeFileSync('/buf-target.txt', 'data');
    vfs.symlinkSync('/buf-target.txt', '/buf-link.txt');
    vfs.mount('/vfs-test-sync-readlink-buf');

    const asString = fs.readlinkSync('/vfs-test-sync-readlink-buf/buf-link.txt');
    assert.strictEqual(asString, '/vfs-test-sync-readlink-buf/buf-target.txt');
  });

  it('re-raises the provider error the gate hit, not a bare ENOENT', () => {
    // The module hooks probe with existsSync before the real call. A provider
    // that fails that probe for a reason worth reporting would otherwise have
    // it flattened into "not found" — which is how a symlink cycle reads as
    // ENOENT instead of ELOOP.
    vfs = create();
    vfs.writeFileSync('/probe-boom.txt', 'data');
    vfs.mount('/vfs-test-probe-reraise');

    const provider = vfs.provider ?? vfs[Object.getOwnPropertySymbols(vfs).find(
      (sym) => String(sym).includes('provider'),
    )];
    const original = provider.existsSync.bind(provider);
    provider.existsSync = () => {
      const err = new Error('ELOOP: too many symbolic links encountered');
      err.code = 'ELOOP';
      throw err;
    };

    try {
      assert.throws(
        () => fs.statSync('/vfs-test-probe-reraise/probe-boom.txt'),
        { code: 'ELOOP' },
      );
      // fs.existsSync itself still has to answer false rather than throw.
      assert.strictEqual(
        fs.existsSync('/vfs-test-probe-reraise/probe-boom.txt'),
        false,
      );
    } finally {
      provider.existsSync = original;
    }
  });

  it('fs.lstatSync still stats a plain file the same way', () => {
    vfs = create();
    vfs.writeFileSync('/plain-lstat.txt', 'data');
    vfs.mount('/vfs-test-sync-lstat-plain');

    const stats = fs.lstatSync('/vfs-test-sync-lstat-plain/plain-lstat.txt');
    assert.strictEqual(stats.isFile(), true);
    assert.strictEqual(stats.isSymbolicLink(), false);
  });
});

describe('Module hooks — path forms', () => {
  let vfs;

  afterEach(() => {
    if (vfs?.mounted) {
      vfs.unmount();
    }
  });

  it('routes Buffer and file: URL paths like the string form', () => {
    vfs = create();
    vfs.writeFileSync('/conf.json', 'VFS COPY');
    vfs.mount('/vfs-test-path-forms');

    const asString = '/vfs-test-path-forms/conf.json';
    assert.strictEqual(fs.readFileSync(asString, 'utf8'), 'VFS COPY');
    assert.strictEqual(fs.readFileSync(Buffer.from(asString), 'utf8'), 'VFS COPY');
    assert.strictEqual(fs.readFileSync(pathToFileURL(asString), 'utf8'), 'VFS COPY');

    const fd = fs.openSync(Buffer.from(asString));
    assert.strictEqual(fs.fstatSync(fd).size, 8);
    fs.closeSync(fd);
  });

  it('resolves a relative path against the virtual cwd', () => {
    vfs = create({ virtualCwd: true });
    vfs.mkdirSync('/app');
    vfs.writeFileSync('/app/package.json', '{"name":"virtual"}');
    vfs.mount('/vfs-test-path-relative');

    const realCwd = process.cwd();
    try {
      process.chdir('/vfs-test-path-relative/app');
      assert.strictEqual(process.cwd(), '/vfs-test-path-relative/app');
      // without resolving against the virtual cwd this reads the real file next to the process
      assert.strictEqual(fs.readFileSync('package.json', 'utf8'), '{"name":"virtual"}');
      const fd = fs.openSync('package.json');
      assert.strictEqual(fs.fstatSync(fd).size, 18);
      fs.closeSync(fd);
    } finally {
      vfs.unmount();
      process.chdir(realCwd);
    }
  });
});

describe('Module hooks — fs.access callback', () => {
  let vfs;

  afterEach(() => {
    if (vfs?.mounted) {
      vfs.unmount();
    }
  });

  it('fs.access calls back without error for existing VFS files', (_, done) => {
    vfs = create();
    vfs.writeFileSync('/cb.txt', 'data');
    vfs.mount('/vfs-test-cb-access');

    fs.access('/vfs-test-cb-access/cb.txt', (err) => {
      assert.ifError(err);
      done();
    });
  });

  it('fs.access calls back with ENOENT for missing VFS files', (_, done) => {
    vfs = create();
    vfs.mount('/vfs-test-cb-access-miss');

    fs.access('/vfs-test-cb-access-miss/nope.txt', (err) => {
      assert.ok(err);
      assert.strictEqual(err.code, 'ENOENT');
      done();
    });
  });
});

describe('Module hooks — fs callback patches', () => {
  let vfs;

  afterEach(() => {
    if (vfs?.mounted) {
      vfs.unmount();
    }
  });

  it('fs.stat calls back with stats for VFS files', (_, done) => {
    vfs = create();
    vfs.writeFileSync('/cb-stat.txt', 'data');
    vfs.mount('/vfs-test-cb-stat');

    fs.stat('/vfs-test-cb-stat/cb-stat.txt', (err, stats) => {
      assert.ifError(err);
      assert.ok(stats.isFile());
      done();
    });
  });

  it('fs.stat calls back with ENOENT for missing VFS files', (_, done) => {
    vfs = create();
    vfs.mount('/vfs-test-cb-stat-miss');

    fs.stat('/vfs-test-cb-stat-miss/nope.txt', (err) => {
      assert.ok(err);
      assert.strictEqual(err.code, 'ENOENT');
      done();
    });
  });

  it('fs.lstat calls back with stats for VFS files', (_, done) => {
    vfs = create();
    vfs.writeFileSync('/cb-lstat.txt', 'data');
    vfs.mount('/vfs-test-cb-lstat');

    fs.lstat('/vfs-test-cb-lstat/cb-lstat.txt', (err, stats) => {
      assert.ifError(err);
      assert.ok(stats.isFile());
      done();
    });
  });

  it('fs.readFile calls back with VFS content', (_, done) => {
    vfs = create();
    vfs.writeFileSync('/cb-read.txt', 'callback content');
    vfs.mount('/vfs-test-cb-readfile');

    fs.readFile('/vfs-test-cb-readfile/cb-read.txt', 'utf8', (err, content) => {
      assert.ifError(err);
      assert.strictEqual(content, 'callback content');
      done();
    });
  });

  it('fs.readFile calls back with ENOENT for missing VFS files', (_, done) => {
    vfs = create();
    vfs.mount('/vfs-test-cb-readfile-miss');

    fs.readFile('/vfs-test-cb-readfile-miss/nope.txt', 'utf8', (err) => {
      assert.ok(err);
      assert.strictEqual(err.code, 'ENOENT');
      done();
    });
  });

  it('fs.readdir calls back with VFS directory entries', (_, done) => {
    vfs = create();
    vfs.writeFileSync('/cbdir/a.txt', 'a');
    vfs.writeFileSync('/cbdir/b.txt', 'b');
    vfs.mount('/vfs-test-cb-readdir');

    fs.readdir('/vfs-test-cb-readdir/cbdir', (err, entries) => {
      assert.ifError(err);
      assert.deepStrictEqual(entries.sort(), ['a.txt', 'b.txt']);
      done();
    });
  });

  it('fs.readlink calls back with VFS symlink target', (_, done) => {
    vfs = create();
    vfs.writeFileSync('/cb-link-target.txt', 'data');
    vfs.symlinkSync('/cb-link-target.txt', '/cb-link.txt');
    vfs.mount('/vfs-test-cb-readlink');

    fs.readlink('/vfs-test-cb-readlink/cb-link.txt', (err, target) => {
      assert.ifError(err);
      assert.strictEqual(target, '/vfs-test-cb-readlink/cb-link-target.txt');
      done();
    });
  });

  it('fs.realpath calls back with resolved VFS path', (_, done) => {
    vfs = create();
    vfs.writeFileSync('/cb-real.txt', 'data');
    vfs.mount('/vfs-test-cb-realpath');

    fs.realpath('/vfs-test-cb-realpath/cb-real.txt', (err, resolved) => {
      assert.ifError(err);
      assert.strictEqual(resolved, '/vfs-test-cb-realpath/cb-real.txt');
      done();
    });
  });

  it('fs.createReadStream returns a readable stream for VFS files', (_, done) => {
    vfs = create();
    vfs.writeFileSync('/stream.txt', 'streamed data');
    vfs.mount('/vfs-test-cb-stream');

    const chunks = [];
    const stream = fs.createReadStream('/vfs-test-cb-stream/stream.txt');
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => {
      assert.strictEqual(Buffer.concat(chunks).toString(), 'streamed data');
      done();
    });
    stream.on('error', done);
  });
});

describe('Module hooks — fs.promises patches', () => {
  let vfs;

  afterEach(() => {
    if (vfs?.mounted) {
      vfs.unmount();
    }
  });

  it('fs.promises.access resolves for existing VFS files', async () => {
    vfs = create();
    vfs.writeFileSync('/paccess.txt', 'data');
    vfs.mount('/vfs-test-p-access');

    await assert.doesNotReject(fsp.access('/vfs-test-p-access/paccess.txt'));
  });

  it('fs.promises.access rejects with ENOENT for missing VFS files', async () => {
    vfs = create();
    vfs.mount('/vfs-test-p-access-miss');

    await assert.rejects(fsp.access('/vfs-test-p-access-miss/nope.txt'), {
      code: 'ENOENT',
    });
  });

  it('fs.promises.readFile reads from VFS', async () => {
    vfs = create();
    vfs.writeFileSync('/pread.txt', 'async vfs content');
    vfs.mount('/vfs-test-p-readfile');

    const content = await fsp.readFile('/vfs-test-p-readfile/pread.txt', 'utf8');
    assert.strictEqual(content, 'async vfs content');
  });

  it('fs.promises.stat returns stats for VFS files', async () => {
    vfs = create();
    vfs.writeFileSync('/pstat.txt', 'data');
    vfs.mount('/vfs-test-p-stat');

    const stats = await fsp.stat('/vfs-test-p-stat/pstat.txt');
    assert.ok(stats.isFile());
  });

  it('fs.promises.lstat returns stats for VFS files', async () => {
    vfs = create();
    vfs.writeFileSync('/plstat.txt', 'data');
    vfs.mount('/vfs-test-p-lstat');

    const stats = await fsp.lstat('/vfs-test-p-lstat/plstat.txt');
    assert.ok(stats.isFile());
  });

  it('fs.promises.readdir lists VFS directory contents', async () => {
    vfs = create();
    vfs.writeFileSync('/pdir/x.txt', 'x');
    vfs.writeFileSync('/pdir/y.txt', 'y');
    vfs.mount('/vfs-test-p-readdir');

    const entries = await fsp.readdir('/vfs-test-p-readdir/pdir');
    assert.deepStrictEqual(entries.sort(), ['x.txt', 'y.txt']);
  });

  it('fs.promises.readlink reads VFS symlinks', async () => {
    vfs = create();
    vfs.writeFileSync('/plink-target.txt', 'data');
    vfs.symlinkSync('/plink-target.txt', '/plink.txt');
    vfs.mount('/vfs-test-p-readlink');

    const target = await fsp.readlink('/vfs-test-p-readlink/plink.txt');
    assert.strictEqual(target, '/vfs-test-p-readlink/plink-target.txt');
  });

  it('fs.promises.realpath resolves VFS paths', async () => {
    vfs = create();
    vfs.writeFileSync('/prealpath.txt', 'data');
    vfs.mount('/vfs-test-p-realpath');

    const resolved = await fsp.realpath('/vfs-test-p-realpath/prealpath.txt');
    assert.strictEqual(resolved, '/vfs-test-p-realpath/prealpath.txt');
  });

  it('require("fs/promises") returns the same patched object', async () => {
    vfs = create();
    vfs.writeFileSync('/shared.txt', 'shared content');
    vfs.mount('/vfs-test-p-shared');

    // Both import paths should see VFS content
    const content1 = await fs.promises.readFile('/vfs-test-p-shared/shared.txt', 'utf8');
    const content2 = await fsp.readFile('/vfs-test-p-shared/shared.txt', 'utf8');
    assert.strictEqual(content1, 'shared content');
    assert.strictEqual(content2, 'shared content');
  });
});

describe('Module hooks — fd family patches', () => {
  let vfs;

  afterEach(() => {
    if (vfs?.mounted) {
      vfs.unmount();
    }
  });

  it('fs.openSync + fs.readSync + fs.closeSync read a VFS file', () => {
    vfs = create();
    vfs.writeFileSync('/fd.txt', 'hello from vfs');
    vfs.mount('/vfs-test-fd-sync');

    const fd = fs.openSync('/vfs-test-fd-sync/fd.txt');
    const buffer = Buffer.alloc(5);
    const bytesRead = fs.readSync(fd, buffer, 0, 5, 0);
    fs.closeSync(fd);

    assert.strictEqual(bytesRead, 5);
    assert.strictEqual(buffer.toString(), 'hello');
  });

  it('fs.openSync throws ENOENT for a missing VFS file', () => {
    vfs = create();
    vfs.writeFileSync('/present.txt', 'x');
    vfs.mount('/vfs-test-fd-missing');

    assert.throws(
      () => fs.openSync('/vfs-test-fd-missing/absent.txt'),
      (err) => err.code === 'ENOENT',
    );
  });

  it('fs.readSync accepts the options-object overload', () => {
    vfs = create();
    vfs.writeFileSync('/opts.txt', 'abcdefgh');
    vfs.mount('/vfs-test-fd-opts');

    const fd = fs.openSync('/vfs-test-fd-opts/opts.txt');
    const buffer = Buffer.alloc(3);
    const bytesRead = fs.readSync(fd, buffer, { offset: 0, length: 3, position: 2 });
    fs.closeSync(fd);

    assert.strictEqual(bytesRead, 3);
    assert.strictEqual(buffer.toString(), 'cde');
  });

  it('fs.fstatSync returns stats for a VFS fd', () => {
    vfs = create();
    vfs.writeFileSync('/stat-fd.txt', 'data');
    vfs.mount('/vfs-test-fd-fstat');

    const fd = fs.openSync('/vfs-test-fd-fstat/stat-fd.txt');
    const stats = fs.fstatSync(fd);
    fs.closeSync(fd);

    assert.ok(stats.isFile());
    assert.strictEqual(stats.size, 4);
  });

  it('sequential fs.readSync calls advance the file position', () => {
    vfs = create();
    vfs.writeFileSync('/seq.txt', 'abcdef');
    vfs.mount('/vfs-test-fd-seq');

    const fd = fs.openSync('/vfs-test-fd-seq/seq.txt');
    const first = Buffer.alloc(3);
    const second = Buffer.alloc(3);
    fs.readSync(fd, first, 0, 3, null);
    fs.readSync(fd, second, 0, 3, null);
    fs.closeSync(fd);

    assert.strictEqual(first.toString(), 'abc');
    assert.strictEqual(second.toString(), 'def');
  });

  it('fs.closeSync on a stale VFS fd throws EBADF', () => {
    vfs = create();
    vfs.writeFileSync('/stale.txt', 'x');
    vfs.mount('/vfs-test-fd-stale');

    const fd = fs.openSync('/vfs-test-fd-stale/stale.txt');
    fs.closeSync(fd);

    assert.throws(() => fs.closeSync(fd), (err) => err.code === 'EBADF');
  });

  it('fs.open + fs.read + fs.close read a VFS file', (_t, done) => {
    vfs = create();
    vfs.writeFileSync('/cb.txt', 'callback content');
    vfs.mount('/vfs-test-fd-cb');

    fs.open('/vfs-test-fd-cb/cb.txt', 'r', (openErr, fd) => {
      assert.ifError(openErr);
      const buffer = Buffer.alloc(8);
      fs.read(fd, buffer, 0, 8, 0, (readErr, bytesRead) => {
        assert.ifError(readErr);
        assert.strictEqual(bytesRead, 8);
        assert.strictEqual(buffer.toString(), 'callback');
        fs.close(fd, (closeErr) => {
          assert.ifError(closeErr);
          done();
        });
      });
    });
  });

  it('fs.fstat returns stats for a VFS fd', (_t, done) => {
    vfs = create();
    vfs.writeFileSync('/fstat-cb.txt', 'seven..');
    vfs.mount('/vfs-test-fd-fstat-cb');

    const fd = fs.openSync('/vfs-test-fd-fstat-cb/fstat-cb.txt');
    fs.fstat(fd, (err, stats) => {
      assert.ifError(err);
      assert.ok(stats.isFile());
      assert.strictEqual(stats.size, 7);
      fs.closeSync(fd);
      done();
    });
  });

  it('real-fs descriptors still work while a VFS is mounted', () => {
    vfs = create();
    vfs.writeFileSync('/unused.txt', 'x');
    vfs.mount('/vfs-test-fd-passthrough');

    const fd = fs.openSync(__filename, 'r');
    const buffer = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, buffer, 0, 12, 0);
    const stats = fs.fstatSync(fd);
    fs.closeSync(fd);

    assert.strictEqual(bytesRead, 12);
    assert.strictEqual(buffer.toString(), "'use strict'");
    assert.ok(stats.size > 0);
  });

  it('an overlay mount leaves non-VFS paths on the real fs', () => {
    vfs = create({ overlay: true });
    vfs.writeFileSync('/only-here.txt', 'vfs');
    vfs.mount('/vfs-test-fd-overlay');

    const fd = fs.openSync('/vfs-test-fd-overlay/only-here.txt');
    assert.strictEqual(fs.fstatSync(fd).size, 3);
    fs.closeSync(fd);

    assert.throws(
      () => fs.openSync('/vfs-test-fd-overlay/not-here.txt'),
      (err) => err.code === 'ENOENT',
    );
  });

  it('fs.readSync defaults length to the space left after offset', () => {
    vfs = create();
    vfs.writeFileSync('/off.txt', 'hello world');
    vfs.mount('/vfs-test-fd-offset');

    const fd = fs.openSync('/vfs-test-fd-offset/off.txt');
    const buffer = Buffer.alloc(10);
    const bytesRead = fs.readSync(fd, buffer, { offset: 4 });

    // 6 bytes fit after the offset, so the position may only advance by 6
    assert.strictEqual(bytesRead, 6);
    assert.strictEqual(buffer.subarray(4, 10).toString(), 'hello ');
    assert.strictEqual(fs.readSync(fd, Buffer.alloc(5), 0, 5, null), 5);
    fs.closeSync(fd);
  });

  it('fs.readSync rejects an out-of-range offset or length', () => {
    vfs = create();
    vfs.writeFileSync('/range.txt', 'abcdef');
    vfs.mount('/vfs-test-fd-range');

    const fd = fs.openSync('/vfs-test-fd-range/range.txt');
    assert.throws(
      () => fs.readSync(fd, Buffer.alloc(4), 0, 100, 0),
      (err) => err.code === 'ERR_OUT_OF_RANGE',
    );
    assert.throws(
      () => fs.readSync(fd, Buffer.alloc(4), 9, 1, 0),
      (err) => err.code === 'ERR_OUT_OF_RANGE',
    );
    fs.closeSync(fd);
  });

  it('a read past EOF returns the remaining bytes, then zero', () => {
    vfs = create();
    vfs.writeFileSync('/eof.txt', 'abc');
    vfs.mount('/vfs-test-fd-eof');

    const fd = fs.openSync('/vfs-test-fd-eof/eof.txt');
    const buffer = Buffer.alloc(8);
    assert.strictEqual(fs.readSync(fd, buffer, 0, 8, null), 3);
    assert.strictEqual(fs.readSync(fd, buffer, 0, 8, null), 0);
    assert.strictEqual(fs.readSync(fd, buffer, 0, 8, 3), 0);
    fs.closeSync(fd);
  });

  it('fs.readSync accepts a bigint position', () => {
    vfs = create();
    vfs.writeFileSync('/big.txt', 'abcdef');
    vfs.mount('/vfs-test-fd-bigint');

    const fd = fs.openSync('/vfs-test-fd-bigint/big.txt');
    const buffer = Buffer.alloc(3);
    const bytesRead = fs.readSync(fd, buffer, 0, 3, 2n);
    fs.closeSync(fd);

    assert.strictEqual(bytesRead, 3);
    assert.strictEqual(buffer.toString(), 'cde');
  });

  it('stat options reach the handle, and bigint is refused rather than mistyped', (_t, done) => {
    vfs = create();
    vfs.writeFileSync('/statopts.txt', 'data');
    vfs.mount('/vfs-test-fd-statopts');

    const fd = fs.openSync('/vfs-test-fd-statopts/statopts.txt');
    const stats = fs.fstatSync(fd, {});
    assert.ok(stats.isFile());
    assert.strictEqual(stats.size, 4);

    // there is no BigIntStats shape here; answering with Number fields would break the
    // caller's first `stats.size > 0n`
    assert.throws(
      () => fs.fstatSync(fd, { bigint: true }),
      (err) => err.code === 'ERR_INVALID_ARG_VALUE',
    );
    assert.throws(
      () => fs.statSync('/vfs-test-fd-statopts/statopts.txt', { bigint: true }),
      (err) => err.code === 'ERR_INVALID_ARG_VALUE',
    );
    fs.fstat(fd, { bigint: true }, (err) => {
      assert.strictEqual(err.code, 'ERR_INVALID_ARG_VALUE');
      fs.closeSync(fd);
      done();
    });
  });

  it('fs.read accepts the (fd, buffer, callback) overload', (_t, done) => {
    vfs = create();
    vfs.writeFileSync('/short.txt', 'abcdef');
    vfs.mount('/vfs-test-fd-short');

    const fd = fs.openSync('/vfs-test-fd-short/short.txt');
    const buffer = Buffer.alloc(6);
    fs.read(fd, buffer, (err, bytesRead, returned) => {
      assert.ifError(err);
      assert.strictEqual(bytesRead, 6);
      assert.strictEqual(returned, buffer);
      assert.strictEqual(buffer.toString(), 'abcdef');
      fs.closeSync(fd);
      done();
    });
  });

  it('close, read and fstat call back with an fd-tagged EBADF on a stale fd', (_t, done) => {
    vfs = create();
    vfs.writeFileSync('/gone.txt', 'x');
    vfs.mount('/vfs-test-fd-gone');

    const fd = fs.openSync('/vfs-test-fd-gone/gone.txt');
    fs.closeSync(fd);

    vfs.close(fd, (closeErr) => {
      assert.strictEqual(closeErr.code, 'EBADF');
      assert.strictEqual(closeErr.fd, fd);
      vfs.read(fd, Buffer.alloc(1), 0, 1, 0, (readErr, bytesRead, buffer) => {
        assert.strictEqual(readErr.code, 'EBADF');
        assert.strictEqual(bytesRead, 0);
        assert.ok(Buffer.isBuffer(buffer));
        vfs.fstat(fd, (fstatErr) => {
          assert.strictEqual(fstatErr.code, 'EBADF');
          assert.strictEqual(fstatErr.fd, fd);
          done();
        });
      });
    });
  });

  it('real-fd shorthand overloads still work while a VFS is mounted', (_t, done) => {
    vfs = create();
    vfs.writeFileSync('/unused.txt', 'x');
    vfs.mount('/vfs-test-fd-arity');

    // node picks these overloads from arguments.length, so the patches must forward it
    fs.open(__filename, (openErr, fd) => {
      assert.ifError(openErr);
      assert.strictEqual(fs.readSync(fd, Buffer.alloc(4), { length: 4 }), 4);
      fs.read(fd, (readErr, bytesRead) => {
        assert.ifError(readErr);
        assert.ok(bytesRead > 0);
        fs.closeSync(fd);
        done();
      });
    });
  });

  it('fd members the VFS does not route reject a virtual fd', () => {
    vfs = create();
    vfs.writeFileSync('/unrouted.txt', 'x');
    vfs.mount('/vfs-test-fd-unrouted');

    const fd = fs.openSync('/vfs-test-fd-unrouted/unrouted.txt');
    assert.throws(() => fs.writeSync(fd, Buffer.from('y')), (err) => err.code === 'EBADF');
    assert.throws(() => fs.ftruncateSync(fd, 0), (err) => err.code === 'EBADF');
    assert.throws(() => fs.fsyncSync(fd), (err) => err.code === 'EBADF');
    fs.closeSync(fd);
  });

  it('fs.fsync calls back with EBADF for a virtual fd', (_t, done) => {
    vfs = create();
    vfs.writeFileSync('/unrouted-cb.txt', 'x');
    vfs.mount('/vfs-test-fd-unrouted-cb');

    const fd = fs.openSync('/vfs-test-fd-unrouted-cb/unrouted-cb.txt');
    fs.fsync(fd, (err) => {
      assert.strictEqual(err.code, 'EBADF');
      assert.strictEqual(err.fd, fd);
      fs.closeSync(fd);
      done();
    });
  });

  it('fs.openSync accepts numeric open flags', () => {
    vfs = create();
    vfs.writeFileSync('/numeric.txt', 'abc');
    vfs.mount('/vfs-test-fd-numeric');

    const fd = fs.openSync('/vfs-test-fd-numeric/numeric.txt', fs.constants.O_RDONLY);
    assert.strictEqual(fs.fstatSync(fd).size, 3);
    fs.closeSync(fd);
  });

  it('write flags route to the VFS on a plain mount and fall through on an overlay', () => {
    vfs = create();
    vfs.writeFileSync('/exists.txt', 'x');
    vfs.mount('/vfs-test-fd-write');

    const fd = fs.openSync('/vfs-test-fd-write/created.txt', 'w');
    fs.closeSync(fd);
    assert.ok(vfs.existsSync('/vfs-test-fd-write/created.txt'));
    vfs.unmount();

    // an overlay mount leaves writes on the real fs, matching readFileSync and createReadStream
    vfs = create({ overlay: true });
    vfs.writeFileSync('/exists.txt', 'x');
    vfs.mount('/vfs-test-fd-write-overlay');

    assert.throws(
      () => fs.openSync('/vfs-test-fd-write-overlay/created.txt', 'w'),
      (err) => err.code === 'ENOENT',
    );
    assert.ok(!vfs.existsSync('/vfs-test-fd-write-overlay/created.txt'));
  });

  it('the fd-taking overloads of readFile, writeFile and appendFile reject a virtual fd', () => {
    vfs = create();
    vfs.writeFileSync('/content.txt', 'hello world');
    vfs.mount('/vfs-test-fd-filemembers');

    const fd = fs.openSync('/vfs-test-fd-filemembers/content.txt');
    // the reserved placeholder is a real descriptor, so an unrouted member would otherwise
    // read the null device and answer with empty content
    assert.throws(() => fs.readFileSync(fd, 'utf8'), (err) => err.code === 'EBADF');
    assert.throws(() => fs.writeFileSync(fd, 'x'), (err) => err.code === 'EBADF');
    assert.throws(() => fs.appendFileSync(fd, 'x'), (err) => err.code === 'EBADF');
    assert.throws(() => fs.createReadStream(fd), (err) => err.code === 'EBADF');
    assert.throws(() => fs.createReadStream('/any', { fd }), (err) => err.code === 'EBADF');
    fs.closeSync(fd);
  });

  it('fs.readFile calls back with EBADF for a virtual fd', (_t, done) => {
    vfs = create();
    vfs.writeFileSync('/cbcontent.txt', 'hello');
    vfs.mount('/vfs-test-fd-readfile-cb');

    const fd = fs.openSync('/vfs-test-fd-readfile-cb/cbcontent.txt');
    fs.readFile(fd, (err) => {
      assert.strictEqual(err.code, 'EBADF');
      fs.closeSync(fd);
      done();
    });
  });

  it('patching fs.read keeps the shape util.promisify expects on a real fd', async () => {
    vfs = create();
    vfs.writeFileSync('/unused.txt', 'x');
    vfs.mount('/vfs-test-fd-promisify');

    const fd = fs.openSync(__filename, 'r');
    // node reads kCustomPromisifyArgs off fs.read to resolve {bytesRead, buffer}
    const result = await promisify(fs.read)(fd, Buffer.alloc(4), 0, 4, 0);
    fs.closeSync(fd);

    assert.strictEqual(result.bytesRead, 4);
    assert.ok(Buffer.isBuffer(result.buffer));
  });

  it('fs.readSync serves the no-buffer overloads from a virtual fd', () => {
    vfs = create();
    vfs.writeFileSync('/nobuf.txt', 'abcdef');
    vfs.mount('/vfs-test-fd-nobuf');

    const fd = fs.openSync('/vfs-test-fd-nobuf/nobuf.txt');
    assert.strictEqual(fs.readSync(fd), 6);
    assert.strictEqual(fs.readSync(fd, { position: 2, length: 3 }), 3);
    fs.closeSync(fd);
  });

  it('fs.read serves the no-buffer overloads from a virtual fd', (_t, done) => {
    vfs = create();
    vfs.writeFileSync('/nobuf-cb.txt', 'abcdef');
    vfs.mount('/vfs-test-fd-nobuf-cb');

    const fd = fs.openSync('/vfs-test-fd-nobuf-cb/nobuf-cb.txt');
    fs.read(fd, (err, bytesRead, buffer) => {
      assert.ifError(err);
      assert.strictEqual(bytesRead, 6);
      assert.strictEqual(buffer.subarray(0, 6).toString(), 'abcdef');
      fs.read(fd, { position: 1, length: 2 }, (err2, bytesRead2, buffer2) => {
        assert.ifError(err2);
        assert.strictEqual(bytesRead2, 2);
        assert.strictEqual(buffer2.subarray(0, 2).toString(), 'bc');
        fs.closeSync(fd);
        done();
      });
    });
  });

  it('a negative position reads from the current position, as node does', () => {
    vfs = create();
    vfs.writeFileSync('/neg.txt', 'abcdef');
    vfs.mount('/vfs-test-fd-negative');

    const fd = fs.openSync('/vfs-test-fd-negative/neg.txt');
    const first = Buffer.alloc(3);
    const second = Buffer.alloc(3);
    assert.strictEqual(fs.readSync(fd, first, 0, 3, -1), 3);
    assert.strictEqual(fs.readSync(fd, second, 0, 3, -1), 3);
    fs.closeSync(fd);

    assert.strictEqual(first.toString(), 'abc');
    assert.strictEqual(second.toString(), 'def');
  });

  it('an out-of-range bigint position throws ERR_OUT_OF_RANGE', () => {
    vfs = create();
    vfs.writeFileSync('/bigrange.txt', 'abcdef');
    vfs.mount('/vfs-test-fd-bigrange');

    const fd = fs.openSync('/vfs-test-fd-bigrange/bigrange.txt');
    assert.throws(
      () => fs.readSync(fd, Buffer.alloc(4), 0, 4, BigInt(Number.MAX_SAFE_INTEGER) + 1n),
      (err) => err.code === 'ERR_OUT_OF_RANGE',
    );
    fs.closeSync(fd);
  });

  it('fs.read and fs.fstat reject a missing callback synchronously', () => {
    vfs = create();
    vfs.writeFileSync('/nocb.txt', 'abc');
    vfs.mount('/vfs-test-fd-nocb');

    const fd = fs.openSync('/vfs-test-fd-nocb/nocb.txt');
    // dispatching to an undefined callback would crash the process from a tick nobody catches
    assert.throws(
      () => fs.read(fd, Buffer.alloc(3), 0, 3, 0),
      (err) => err.code === 'ERR_INVALID_ARG_TYPE',
    );
    assert.throws(() => fs.fstat(fd), (err) => err.code === 'ERR_INVALID_ARG_TYPE');
    fs.closeSync(fd);
  });

  it('numeric open flags ignore advisory bits and reject unmapped combinations', (_t, done) => {
    vfs = create();
    vfs.writeFileSync('/flags.txt', 'abc');
    vfs.mount('/vfs-test-fd-flags');

    const fd = fs.openSync('/vfs-test-fd-flags/flags.txt', fs.constants.O_RDONLY | fs.constants.O_CLOEXEC);
    assert.strictEqual(fs.fstatSync(fd).size, 3);
    fs.closeSync(fd);

    assert.throws(
      () => fs.openSync('/vfs-test-fd-flags/flags.txt', fs.constants.O_EXCL),
      (err) => err.code === 'ERR_INVALID_ARG_VALUE',
    );
    // the async form reports it through the callback rather than throwing at the call site
    fs.open('/vfs-test-fd-flags/flags.txt', fs.constants.O_EXCL, (err) => {
      assert.strictEqual(err.code, 'ERR_INVALID_ARG_VALUE');
      done();
    });
  });

  it('an unrouted fd member with no callback throws instead of dispatching', () => {
    vfs = create();
    vfs.writeFileSync('/nocb2.txt', 'x');
    vfs.mount('/vfs-test-fd-unrouted-nocb');

    const fd = fs.openSync('/vfs-test-fd-unrouted-nocb/nocb2.txt');
    assert.throws(() => fs.fsync(fd), (err) => err.code === 'EBADF');
    fs.closeSync(fd);
  });

  it('real-fd fstat and close still work asynchronously while a VFS is mounted', (_t, done) => {
    vfs = create();
    vfs.writeFileSync('/unused2.txt', 'x');
    vfs.mount('/vfs-test-fd-real-async');

    const fd = fs.openSync(__filename, 'r');
    fs.fstat(fd, (statErr, stats) => {
      assert.ifError(statErr);
      assert.ok(stats.size > 0);
      fs.close(fd, (closeErr) => {
        assert.ifError(closeErr);
        done();
      });
    });
  });

  it('EBADF carries errno and names the fd in its message', () => {
    vfs = create();
    vfs.writeFileSync('/errctx.txt', 'x');
    vfs.mount('/vfs-test-fd-errctx');

    const fd = fs.openSync('/vfs-test-fd-errctx/errctx.txt');
    fs.closeSync(fd);

    // through fs.* a released fd is no longer ours and falls through to the real fs, as a
    // closed real descriptor would; the VFS API is where our own EBADF is raised
    assert.throws(() => vfs.readSync(fd, Buffer.alloc(1), 0, 1, 0), (err) => {
      assert.strictEqual(err.code, 'EBADF');
      assert.strictEqual(err.errno, -9);
      assert.strictEqual(err.fd, fd);
      assert.match(err.message, new RegExp(`fd ${fd}$`));
      return true;
    });
  });

  it('the fs patches serve real paths after unmount and route again on a second mount', () => {
    vfs = create();
    vfs.writeFileSync('/first.txt', 'first');
    vfs.mount('/vfs-test-fd-isolation');

    const first = fs.openSync('/vfs-test-fd-isolation/first.txt');
    assert.strictEqual(fs.fstatSync(first).size, 5);
    fs.closeSync(first);
    vfs.unmount();

    const realFd = fs.openSync(__filename, 'r');
    assert.ok(fs.fstatSync(realFd).size > 0);
    fs.closeSync(realFd);
    assert.throws(
      () => fs.openSync('/vfs-test-fd-isolation/first.txt'),
      (err) => err.code === 'ENOENT',
    );

    vfs = create();
    vfs.writeFileSync('/second.txt', 'second!');
    vfs.mount('/vfs-test-fd-isolation-2');

    const second = fs.openSync('/vfs-test-fd-isolation-2/second.txt');
    assert.strictEqual(fs.fstatSync(second).size, 7);
    fs.closeSync(second);
  });
});
