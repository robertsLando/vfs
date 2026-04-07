'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { create, SqliteProvider } = require('../index.js');

// Helper: create a mounted VFS with given files, run fn, then clean up.
function withVFS(files, fn) {
  const provider = new SqliteProvider();
  const vfs = create(provider);
  for (const [path, content] of Object.entries(files)) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    if (dir && dir !== '/') {
      vfs.mkdirSync(dir, { recursive: true });
    }
    vfs.writeFileSync(path, content);
  }
  vfs.mount('/');
  try {
    fn(vfs);
  } finally {
    // Clean up require cache for all VFS paths
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith('/node_modules/') || key.startsWith('/app/')) {
        delete require.cache[key];
      }
    }
    vfs.unmount();
    provider.close();
  }
}

describe('Module resolution — built-in shadowing', () => {
  it('require("buffer") resolves to Node.js built-in, not userland polyfill', () => {
    withVFS({
      '/node_modules/buffer/index.js':
        'module.exports = { __vfsPolyfill: true };',
      '/node_modules/buffer/package.json':
        '{"name":"buffer","main":"index.js"}',
    }, () => {
      const buf = require('buffer');
      // Node.js built-in buffer module exports Buffer constructor
      assert.ok(buf.Buffer, 'should have Buffer from built-in');
      assert.strictEqual(buf.__vfsPolyfill, undefined,
                         'should NOT resolve to userland polyfill');
    });
  });

  it('require("node:buffer") still resolves to built-in', () => {
    withVFS({
      '/node_modules/buffer/index.js':
        'module.exports = { __vfsPolyfill: true };',
      '/node_modules/buffer/package.json':
        '{"name":"buffer","main":"index.js"}',
    }, () => {
      const buf = require('node:buffer');
      assert.ok(buf.Buffer);
      assert.strictEqual(buf.__vfsPolyfill, undefined);
    });
  });
});

describe('Module resolution — file-before-directory', () => {
  it('require("./schema") resolves to schema.js when both schema.js and schema/ exist', () => {
    withVFS({
      '/app/schema.js':
        'module.exports = "file";',
      '/app/schema/index.js':
        'module.exports = "directory";',
      '/app/entry.js':
        'module.exports = require("./schema");',
      '/app/package.json':
        '{"name":"app","main":"entry.js"}',
    }, () => {
      const result = require('/app/entry.js');
      assert.strictEqual(result, 'file',
                         'file.js should take precedence over directory/index.js');
    });
  });
});

describe('Module resolution — require.resolve() interception', () => {
  it('require.resolve() resolves packages inside VFS', () => {
    withVFS({
      '/node_modules/vfs-resolve-test/index.js':
        'module.exports = 42;',
      '/node_modules/vfs-resolve-test/package.json':
        '{"name":"vfs-resolve-test","main":"index.js"}',
    }, () => {
      const resolved = require.resolve('vfs-resolve-test');
      assert.strictEqual(resolved, '/node_modules/vfs-resolve-test/index.js');
    });
  });
});

describe('Module resolution — trailing slash in specifiers', () => {
  it('require("process/") resolves the package entry point', () => {
    // Simulates the pattern used by readable-stream: require('process/')
    // where packageSubpath becomes './' and must be normalized to '.'
    withVFS({
      '/node_modules/vfs-trailing-slash/index.js':
        'module.exports = { trailingSlash: true };',
      '/node_modules/vfs-trailing-slash/package.json':
        '{"name":"vfs-trailing-slash","main":"index.js"}',
    }, () => {
      const mod = require('vfs-trailing-slash/');
      assert.deepStrictEqual(mod, { trailingSlash: true });
    });
  });
});

describe('Module resolution — main pointing to directory', () => {
  it('resolves index.js when package.json main points to a directory', () => {
    // Simulates packages like got v11: "main": "dist/source"
    // where dist/source is a directory containing index.js
    withVFS({
      '/node_modules/vfs-main-dir/package.json':
        '{"name":"vfs-main-dir","main":"dist/source"}',
      '/node_modules/vfs-main-dir/dist/source/index.js':
        'module.exports = { mainDir: true };',
    }, () => {
      const mod = require('vfs-main-dir');
      assert.deepStrictEqual(mod, { mainDir: true });
    });
  });

  it('resolves index.json when main directory has no index.js', () => {
    withVFS({
      '/node_modules/vfs-main-dir-json/package.json':
        '{"name":"vfs-main-dir-json","main":"lib"}',
      '/node_modules/vfs-main-dir-json/lib/index.json':
        '{"fromJson":true}',
    }, () => {
      const mod = require('vfs-main-dir-json');
      assert.deepStrictEqual(mod, { fromJson: true });
    });
  });
});
