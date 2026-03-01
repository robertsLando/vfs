'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../index.js');

describe('VirtualFileSystem - promises API', () => {
  let vfs;

  beforeEach(() => {
    vfs = create({ moduleHooks: false });
  });

  it('promises.writeFile and promises.readFile', async () => {
    await vfs.promises.writeFile('/async.txt', 'async content');
    const content = await vfs.promises.readFile('/async.txt', 'utf8');
    assert.strictEqual(content, 'async content');
  });

  it('promises.stat returns stats', async () => {
    await vfs.promises.writeFile('/stat-async.txt', 'data');
    const stats = await vfs.promises.stat('/stat-async.txt');
    assert.ok(stats.isFile());
    assert.strictEqual(stats.size, 4);
  });

  it('promises.mkdir creates directory', async () => {
    await vfs.promises.mkdir('/async-dir', { recursive: true });
    const stats = await vfs.promises.stat('/async-dir');
    assert.ok(stats.isDirectory());
  });

  it('promises.readdir lists entries', async () => {
    await vfs.promises.writeFile('/async-dir2/a.txt', 'a');
    await vfs.promises.writeFile('/async-dir2/b.txt', 'b');
    const entries = await vfs.promises.readdir('/async-dir2');
    assert.deepStrictEqual(entries.sort(), ['a.txt', 'b.txt']);
  });

  it('promises.unlink removes files', async () => {
    await vfs.promises.writeFile('/to-unlink.txt', 'bye');
    await vfs.promises.unlink('/to-unlink.txt');
    await assert.rejects(vfs.promises.stat('/to-unlink.txt'), {
      code: 'ENOENT',
    });
  });

  it('promises.rename moves files', async () => {
    await vfs.promises.writeFile('/rename-old.txt', 'data');
    await vfs.promises.rename('/rename-old.txt', '/rename-new.txt');
    const content = await vfs.promises.readFile('/rename-new.txt', 'utf8');
    assert.strictEqual(content, 'data');
  });

  it('promises.appendFile appends data', async () => {
    await vfs.promises.writeFile('/append-async.txt', 'Hello');
    await vfs.promises.appendFile('/append-async.txt', ' World');
    const content = await vfs.promises.readFile('/append-async.txt', 'utf8');
    assert.strictEqual(content, 'Hello World');
  });

  it('promises.copyFile copies a file', async () => {
    await vfs.promises.writeFile('/copy-src.txt', 'source');
    await vfs.promises.copyFile('/copy-src.txt', '/copy-dest.txt');
    const content = await vfs.promises.readFile('/copy-dest.txt', 'utf8');
    assert.strictEqual(content, 'source');
  });

  it('promises.access does not reject for existing files', async () => {
    await vfs.promises.writeFile('/accessible.txt', 'ok');
    await assert.doesNotReject(vfs.promises.access('/accessible.txt'));
  });

  it('promises.access rejects for non-existing files', async () => {
    await assert.rejects(vfs.promises.access('/inaccessible.txt'), {
      code: 'ENOENT',
    });
  });

  it('promises.symlink and readlink', async () => {
    await vfs.promises.writeFile('/sym-target.txt', 'data');
    await vfs.promises.symlink('/sym-target.txt', '/sym-link.txt');
    const target = await vfs.promises.readlink('/sym-link.txt');
    assert.strictEqual(target, '/sym-target.txt');
  });

  it('promises.lstat returns symlink stats', async () => {
    await vfs.promises.writeFile('/lstat-target.txt', 'data');
    await vfs.promises.symlink('/lstat-target.txt', '/lstat-link.txt');
    const stats = await vfs.promises.lstat('/lstat-link.txt');
    assert.ok(stats.isSymbolicLink());
  });

  it('promises.realpath resolves symlinks', async () => {
    await vfs.promises.writeFile('/rp-target.txt', 'data');
    await vfs.promises.symlink('/rp-target.txt', '/rp-link.txt');
    const realpath = await vfs.promises.realpath('/rp-link.txt');
    assert.strictEqual(realpath, '/rp-target.txt');
  });

  it('promises.rmdir removes empty directory', async () => {
    await vfs.promises.mkdir('/empty-async');
    await vfs.promises.rmdir('/empty-async');
    await assert.rejects(vfs.promises.stat('/empty-async'), {
      code: 'ENOENT',
    });
  });
});
