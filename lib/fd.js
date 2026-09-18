'use strict';

// Captured before installFsPatches runs, so reserving a descriptor can never re-enter
// the patched fs.
const { openSync: reserveFd, closeSync: releaseFd } = require('node:fs');
const { devNull } = require('node:os');

const { createEBADF, ERR_OUT_OF_RANGE, ERR_INVALID_ARG_TYPE } = require('./errors.js');
const { rejectBigIntStats } = require('./stats.js');

const kFd = Symbol('kFd');
const kEntry = Symbol('kEntry');

const openFDs = new Map();

class VirtualFD {
  constructor(fd, entry) {
    this[kFd] = fd;
    this[kEntry] = entry;
  }

  get fd() {
    return this[kFd];
  }

  get entry() {
    return this[kEntry];
  }
}

/**
 * Registers an open provider handle under a fresh virtual fd.
 *
 * The number has to be one no real descriptor can also hold: the kernel hands out the
 * lowest free fd, so any fixed range is reachable by a process with enough files open.
 * Reserving a real descriptor on the null device makes the number unique by construction.
 *
 * The placeholder is write-only on purpose: an fs member that takes an fd and is not routed
 * here would otherwise read the null device and hand back empty content instead of failing.
 * @param {object} entry Open provider file handle.
 * @returns {number} The virtual fd.
 */
function openVirtualFd(entry) {
  const fd = reserveFd(devNull, 'w');
  openFDs.set(fd, new VirtualFD(fd, entry));
  return fd;
}

/**
 * Looks up the handle behind a virtual fd.
 * @param {number} fd Descriptor to resolve.
 * @returns {VirtualFD|undefined} The handle, or undefined when the fd is not virtual.
 */
function getVirtualFd(fd) {
  // every patched fd member calls this, mounted or not
  return openFDs.size === 0 ? undefined : openFDs.get(fd);
}

/**
 * Deregisters a virtual fd and releases the real descriptor reserved for it.
 * @param {number} fd Descriptor to release.
 * @returns {boolean} Whether the fd was registered.
 */
function closeVirtualFd(fd) {
  if (!openFDs.has(fd)) {
    return false;
  }
  try {
    releaseFd(fd);
  } finally {
    // deregister even if the release failed, or the number stays routed to a dead handle
    openFDs.delete(fd);
  }
  return true;
}

function requireVirtualFd(fd, syscall) {
  const vfd = getVirtualFd(fd);
  if (!vfd) {
    throw createEBADF(syscall, fd);
  }
  return vfd;
}

const DEFAULT_READ_SIZE = 16384;
const kEmptyOptions = Object.freeze({});

function toReadPosition(position) {
  if (typeof position !== 'bigint') {
    // node reads from the current position for null, undefined and any negative value
    return position == null || position < 0 ? null : position;
  }
  if (position > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ERR_OUT_OF_RANGE('position', `>= 0 && <= ${Number.MAX_SAFE_INTEGER}`, position);
  }
  return position < 0n ? null : Number(position);
}

function requireCallback(callback) {
  if (typeof callback !== 'function') {
    throw new ERR_INVALID_ARG_TYPE('callback', 'function', callback);
  }
  return callback;
}

function toReadArgs(buffer, offset, length, position) {
  const readOffset = offset ?? 0;
  // node defaults length to what is left in the buffer after offset, not to its whole size
  const readLength = length ?? buffer.byteLength - readOffset;

  if (readOffset < 0 || readOffset > buffer.byteLength) {
    throw new ERR_OUT_OF_RANGE('offset', `>= 0 && <= ${buffer.byteLength}`, readOffset);
  }
  if (readLength < 0 || readOffset + readLength > buffer.byteLength) {
    throw new ERR_OUT_OF_RANGE('length', `>= 0 && <= ${buffer.byteLength - readOffset}`, readLength);
  }

  return [buffer, readOffset, readLength, toReadPosition(position)];
}

function fromReadOptions(buffer, options) {
  const buf = buffer ?? options.buffer ?? Buffer.alloc(DEFAULT_READ_SIZE);
  return toReadArgs(buf, options.offset, options.length, options.position);
}

// fs.read/readSync accept (fd, buffer, offset, length, position),
// (fd, buffer, options), (fd, options) and (fd).  Collapse to positional form.
function normalizeReadArgs(buffer, offset, length, position) {
  if (buffer == null) {
    return fromReadOptions(null, kEmptyOptions);
  }

  if (!ArrayBuffer.isView(buffer)) {
    return fromReadOptions(null, buffer);
  }

  if (offset !== null && typeof offset === 'object') {
    return fromReadOptions(buffer, offset);
  }

  return toReadArgs(buffer, offset, length, position);
}

// The callback is always the last function argument, whichever overload was used.
function splitCallback(args) {
  const at = args.findIndex((arg) => typeof arg === 'function');
  if (at === -1) {
    return null;
  }
  const callback = args[at];
  args.length = at;
  return callback;
}

// The operations below are keyed on the fd alone: a handle carries its own
// content and position, so which VirtualFileSystem opened it is irrelevant.
// VirtualFileSystem and the node:fs patches both delegate here.

/**
 * Closes a virtual fd.
 * @param {number} fd Descriptor to close.
 * @throws {Error} EBADF when the fd is not open.
 */
function closeFdSync(fd) {
  const vfd = requireVirtualFd(fd, 'close');
  try {
    vfd.entry.closeSync();
  } finally {
    // the fd is spent either way; leaving it registered would keep stale content readable.
    // a failure releasing the placeholder must not replace the provider's own error.
    try {
      closeVirtualFd(fd);
    } catch {
      openFDs.delete(fd);
    }
  }
}

/**
 * Reads from a virtual fd, accepting every fs.readSync overload.
 * @param {number} fd Descriptor to read from.
 * @param {Buffer|object} [buffer] Target buffer, or an options object.
 * @param {number|object} [offset] Offset into the buffer, or an options object.
 * @param {number} [length] Bytes to read, defaulting to the rest of the buffer.
 * @param {number|bigint|null} [position] Absolute position, or null to read sequentially.
 * @returns {number} Bytes read.
 */
function readFdSync(fd, buffer, offset, length, position) {
  const vfd = requireVirtualFd(fd, 'read');
  const args = normalizeReadArgs(buffer, offset, length, position);
  return vfd.entry.readSync(args[0], args[1], args[2], args[3]);
}

/**
 * Stats the file behind a virtual fd.
 * @param {number} fd Descriptor to stat.
 * @param {object} [options] Stat options, forwarded to the provider.
 * @returns {object} Stats for the open file.
 */
function fstatFdSync(fd, options) {
  rejectBigIntStats(options);
  return requireVirtualFd(fd, 'fstat').entry.statSync(options);
}

// Mirrors node's own default close callback: a failure is raised, never swallowed.
function defaultCloseCallback(err) {
  if (err !== null) {
    throw err;
  }
}

/**
 * Closes a virtual fd, asynchronously.
 * @param {number} fd Descriptor to close.
 * @param {Function} [callback] Receives an EBADF when the fd is not open.
 */
function closeFd(fd, callback = defaultCloseCallback) {
  requireCallback(callback);
  const vfd = getVirtualFd(fd);
  if (!vfd) {
    process.nextTick(callback, createEBADF('close', fd));
    return;
  }

  // dispatched off the promise chain, so a throw from the callback is not swallowed as a rejection
  vfd.entry.close().then(
    () => {
      closeVirtualFd(fd);
      process.nextTick(callback, null);
    },
    (err) => {
      closeVirtualFd(fd);
      process.nextTick(callback, err);
    },
  );
}

/**
 * Reads from a virtual fd, accepting every fs.read overload.
 * @param {number} fd Descriptor to read from.
 * @param {Buffer|object|Function} [buffer] Target buffer, options object, or the callback.
 * @param {number|object|Function} [offset] Offset, options object, or the callback.
 * @param {number|Function} [length] Bytes to read, or the callback.
 * @param {number|bigint|null|Function} [position] Position, or the callback.
 * @param {Function} [callback] Receives `(err, bytesRead, buffer)`.
 */
function readFd(fd, buffer, offset, length, position, callback) {
  const rest = [buffer, offset, length, position];
  callback = requireCallback(splitCallback(rest) ?? callback);

  // normalized first, so the callback's third argument is the buffer node would have passed
  const [buf, readOffset, readLength, readPosition] =
    normalizeReadArgs(rest[0], rest[1], rest[2], rest[3]);

  const vfd = getVirtualFd(fd);
  if (!vfd) {
    process.nextTick(callback, createEBADF('read', fd), 0, buf);
    return;
  }

  vfd.entry.read(buf, readOffset, readLength, readPosition).then(
    ({ bytesRead }) => process.nextTick(callback, null, bytesRead, buf),
    (err) => process.nextTick(callback, err, 0, buf),
  );
}

/**
 * Stats the file behind a virtual fd, asynchronously.
 * @param {number} fd Descriptor to stat.
 * @param {object|Function} [options] Stat options, or the callback.
 * @param {Function} [callback] Receives `(err, stats)`.
 */
function fstatFd(fd, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = undefined;
  }
  requireCallback(callback);

  try {
    rejectBigIntStats(options);
  } catch (err) {
    process.nextTick(callback, err);
    return;
  }

  const vfd = getVirtualFd(fd);
  if (!vfd) {
    process.nextTick(callback, createEBADF('fstat', fd));
    return;
  }

  vfd.entry.stat(options).then(
    (stats) => process.nextTick(callback, null, stats),
    (err) => process.nextTick(callback, err),
  );
}

module.exports = {
  VirtualFD,
  openVirtualFd,
  getVirtualFd,
  closeVirtualFd,
  closeFdSync,
  readFdSync,
  fstatFdSync,
  closeFd,
  readFd,
  fstatFd,
};
