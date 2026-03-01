'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { create, VirtualFileSystem, MemoryProvider } = require('../index.js');

describe('create()', () => {
  it('creates a VFS with default MemoryProvider', () => {
    const vfs = create({ moduleHooks: false });
    assert.ok(vfs instanceof VirtualFileSystem);
    assert.ok(vfs.provider instanceof MemoryProvider);
  });

  it('creates a VFS with a custom provider', () => {
    const provider = new MemoryProvider();
    const vfs = create(provider, { moduleHooks: false });
    assert.strictEqual(vfs.provider, provider);
  });

  it('accepts options as first argument', () => {
    const vfs = create({ moduleHooks: false, overlay: true });
    assert.strictEqual(vfs.overlay, true);
  });
});

describe('VirtualFileSystem - basic file operations', () => {
  let vfs;

  beforeEach(() => {
    vfs = create({ moduleHooks: false });
  });

  it('writeFileSync and readFileSync', () => {
    vfs.writeFileSync('/hello.txt', 'Hello, World!');
    const content = vfs.readFileSync('/hello.txt', 'utf8');
    assert.strictEqual(content, 'Hello, World!');
  });

  it('readFileSync returns Buffer by default', () => {
    vfs.writeFileSync('/data.bin', Buffer.from([1, 2, 3]));
    const content = vfs.readFileSync('/data.bin');
    assert.ok(Buffer.isBuffer(content));
    assert.deepStrictEqual([...content], [1, 2, 3]);
  });

  it('existsSync returns true for existing files', () => {
    vfs.writeFileSync('/exists.txt', 'yes');
    assert.strictEqual(vfs.existsSync('/exists.txt'), true);
  });

  it('existsSync returns false for non-existing files', () => {
    assert.strictEqual(vfs.existsSync('/nope.txt'), false);
  });

  it('statSync returns stats for a file', () => {
    vfs.writeFileSync('/stat-test.txt', 'content');
    const stats = vfs.statSync('/stat-test.txt');
    assert.ok(stats.isFile());
    assert.strictEqual(stats.isDirectory(), false);
    assert.strictEqual(stats.size, 7);
  });

  it('unlinkSync removes a file', () => {
    vfs.writeFileSync('/to-delete.txt', 'bye');
    assert.strictEqual(vfs.existsSync('/to-delete.txt'), true);
    vfs.unlinkSync('/to-delete.txt');
    assert.strictEqual(vfs.existsSync('/to-delete.txt'), false);
  });

  it('appendFileSync appends data', () => {
    vfs.writeFileSync('/append.txt', 'Hello');
    vfs.appendFileSync('/append.txt', ' World');
    const content = vfs.readFileSync('/append.txt', 'utf8');
    assert.strictEqual(content, 'Hello World');
  });

  it('copyFileSync copies a file', () => {
    vfs.writeFileSync('/original.txt', 'original content');
    vfs.copyFileSync('/original.txt', '/copy.txt');
    const content = vfs.readFileSync('/copy.txt', 'utf8');
    assert.strictEqual(content, 'original content');
  });

  it('renameSync moves a file', () => {
    vfs.writeFileSync('/old-name.txt', 'data');
    vfs.renameSync('/old-name.txt', '/new-name.txt');
    assert.strictEqual(vfs.existsSync('/old-name.txt'), false);
    assert.strictEqual(vfs.readFileSync('/new-name.txt', 'utf8'), 'data');
  });

  it('throws ENOENT for non-existing file read', () => {
    assert.throws(() => vfs.readFileSync('/nonexistent.txt'), {
      code: 'ENOENT',
    });
  });

  it('accessSync does not throw for existing file', () => {
    vfs.writeFileSync('/access.txt', 'ok');
    assert.doesNotThrow(() => vfs.accessSync('/access.txt'));
  });

  it('accessSync throws for non-existing file', () => {
    assert.throws(() => vfs.accessSync('/no-access.txt'), {
      code: 'ENOENT',
    });
  });
});

describe('VirtualFileSystem - directory operations', () => {
  let vfs;

  beforeEach(() => {
    vfs = create({ moduleHooks: false });
  });

  it('mkdirSync creates a directory', () => {
    vfs.mkdirSync('/mydir');
    const stats = vfs.statSync('/mydir');
    assert.ok(stats.isDirectory());
  });

  it('mkdirSync with recursive creates nested dirs', () => {
    vfs.mkdirSync('/a/b/c', { recursive: true });
    assert.ok(vfs.statSync('/a').isDirectory());
    assert.ok(vfs.statSync('/a/b').isDirectory());
    assert.ok(vfs.statSync('/a/b/c').isDirectory());
  });

  it('readdirSync lists directory contents', () => {
    vfs.writeFileSync('/dir-test/file1.txt', 'a');
    vfs.writeFileSync('/dir-test/file2.txt', 'b');
    const entries = vfs.readdirSync('/dir-test');
    assert.deepStrictEqual(entries.sort(), ['file1.txt', 'file2.txt']);
  });

  it('readdirSync with withFileTypes returns dirents', () => {
    vfs.writeFileSync('/typed/file.txt', 'data');
    vfs.mkdirSync('/typed/subdir');
    const entries = vfs.readdirSync('/typed', { withFileTypes: true });
    assert.strictEqual(entries.length, 2);

    const file = entries.find((e) => e.name === 'file.txt');
    const dir = entries.find((e) => e.name === 'subdir');
    assert.ok(file.isFile());
    assert.ok(dir.isDirectory());
  });

  it('rmdirSync removes an empty directory', () => {
    vfs.mkdirSync('/empty-dir');
    vfs.rmdirSync('/empty-dir');
    assert.strictEqual(vfs.existsSync('/empty-dir'), false);
  });

  it('rmdirSync throws ENOTEMPTY for non-empty directory', () => {
    vfs.writeFileSync('/notempty/file.txt', 'data');
    assert.throws(() => vfs.rmdirSync('/notempty'), {
      code: 'ENOTEMPTY',
    });
  });

  it('mkdirSync throws EEXIST for existing path', () => {
    vfs.mkdirSync('/existing');
    assert.throws(() => vfs.mkdirSync('/existing'), {
      code: 'EEXIST',
    });
  });
});

describe('VirtualFileSystem - file descriptor operations', () => {
  let vfs;

  beforeEach(() => {
    vfs = create({ moduleHooks: false });
  });

  it('openSync/closeSync work', () => {
    vfs.writeFileSync('/fd-test.txt', 'hello');
    const fd = vfs.openSync('/fd-test.txt');
    assert.ok(typeof fd === 'number');
    assert.ok(fd >= 10000);
    vfs.closeSync(fd);
  });

  it('readSync reads from file descriptor', () => {
    vfs.writeFileSync('/fd-read.txt', 'hello world');
    const fd = vfs.openSync('/fd-read.txt');
    const buf = Buffer.alloc(5);
    const bytesRead = vfs.readSync(fd, buf, 0, 5, 0);
    assert.strictEqual(bytesRead, 5);
    assert.strictEqual(buf.toString(), 'hello');
    vfs.closeSync(fd);
  });

  it('fstatSync returns stats from file descriptor', () => {
    vfs.writeFileSync('/fd-stat.txt', 'content');
    const fd = vfs.openSync('/fd-stat.txt');
    const stats = vfs.fstatSync(fd);
    assert.ok(stats.isFile());
    assert.strictEqual(stats.size, 7);
    vfs.closeSync(fd);
  });

  it('throws EBADF for invalid fd', () => {
    assert.throws(() => vfs.closeSync(99999), {
      code: 'EBADF',
    });
  });
});

describe('VirtualFileSystem - symlinks', () => {
  let vfs;

  beforeEach(() => {
    vfs = create({ moduleHooks: false });
  });

  it('symlinkSync and readlinkSync', () => {
    vfs.writeFileSync('/target.txt', 'target content');
    vfs.symlinkSync('/target.txt', '/link.txt');

    const target = vfs.readlinkSync('/link.txt');
    assert.strictEqual(target, '/target.txt');
  });

  it('symlinks are followed for readFileSync', () => {
    vfs.writeFileSync('/real.txt', 'real content');
    vfs.symlinkSync('/real.txt', '/sym.txt');

    const content = vfs.readFileSync('/sym.txt', 'utf8');
    assert.strictEqual(content, 'real content');
  });

  it('lstatSync returns symlink stats', () => {
    vfs.writeFileSync('/real2.txt', 'data');
    vfs.symlinkSync('/real2.txt', '/sym2.txt');

    const lstat = vfs.lstatSync('/sym2.txt');
    assert.ok(lstat.isSymbolicLink());

    const stat = vfs.statSync('/sym2.txt');
    assert.ok(stat.isFile());
  });

  it('realpathSync resolves symlinks', () => {
    vfs.writeFileSync('/realfile.txt', 'data');
    vfs.symlinkSync('/realfile.txt', '/symfile.txt');

    const realpath = vfs.realpathSync('/symfile.txt');
    assert.strictEqual(realpath, '/realfile.txt');
  });

  it('throws EEXIST when creating symlink over existing', () => {
    vfs.writeFileSync('/existing-file.txt', 'data');
    assert.throws(() => vfs.symlinkSync('/somewhere', '/existing-file.txt'), {
      code: 'EEXIST',
    });
  });
});

describe('VirtualFileSystem - read-only', () => {
  it('setReadOnly prevents writes', () => {
    const provider = new MemoryProvider();
    const vfs = create(provider, { moduleHooks: false });

    vfs.writeFileSync('/before.txt', 'ok');
    provider.setReadOnly();

    assert.throws(() => vfs.writeFileSync('/after.txt', 'fail'), {
      code: 'EROFS',
    });
    assert.strictEqual(vfs.readFileSync('/before.txt', 'utf8'), 'ok');
  });
});
