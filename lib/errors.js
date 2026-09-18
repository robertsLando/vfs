'use strict';

/**
 * Creates a filesystem error with the proper structure.
 * Mirrors the UVException format from Node.js internals.
 * @param {string} code The error code (e.g., 'ENOENT')
 * @param {string} syscall The system call name
 * @param {string} [path] The path that caused the error
 * @param {string} [message] The error message
 * @returns {Error}
 */
// Retry and compatibility shims (graceful-fs, fs-extra) branch on errno, which these
// errors now reach as node:fs errors through the fs patches.  libuv's numbers differ per
// platform (ELOOP is -40 on linux, -62 on macOS, in the -4000 range on Windows), so read
// them from the running platform rather than hardcoding one.
const { errno: SYSTEM_ERRNO } = require('node:os').constants;

function createFsError(code, syscall, path, message) {
  const msg = message || `${code}: ${getErrorDescription(code)}, ${syscall}${path ? ` '${path}'` : ''}`;
  const err = new Error(msg);
  err.code = code;
  err.syscall = syscall;
  if (SYSTEM_ERRNO[code] !== undefined) {
    err.errno = -SYSTEM_ERRNO[code];
  }
  if (path !== undefined) {
    err.path = path;
  }
  Error.captureStackTrace(err, createFsError);
  return err;
}

function getErrorDescription(code) {
  switch (code) {
    case 'ENOENT': return 'no such file or directory';
    case 'ENOTDIR': return 'not a directory';
    case 'ENOTEMPTY': return 'directory not empty';
    case 'EISDIR': return 'illegal operation on a directory';
    case 'EBADF': return 'bad file descriptor';
    case 'EEXIST': return 'file already exists';
    case 'EROFS': return 'read-only file system';
    case 'EINVAL': return 'invalid argument';
    case 'ELOOP': return 'too many levels of symbolic links';
    default: return 'unknown error';
  }
}

function createENOENT(syscall, path) {
  const err = createFsError('ENOENT', syscall, path);
  Error.captureStackTrace(err, createENOENT);
  return err;
}

function createENOTDIR(syscall, path) {
  const err = createFsError('ENOTDIR', syscall, path);
  Error.captureStackTrace(err, createENOTDIR);
  return err;
}

function createENOTEMPTY(syscall, path) {
  const err = createFsError('ENOTEMPTY', syscall, path);
  Error.captureStackTrace(err, createENOTEMPTY);
  return err;
}

function createEISDIR(syscall, path) {
  const err = createFsError('EISDIR', syscall, path);
  Error.captureStackTrace(err, createEISDIR);
  return err;
}

function createEBADF(syscall, fd) {
  // the fd goes in the message too: ad-hoc logging captures .message or .stack, not .fd
  // let createFsError compose the message; only the fd suffix is ours
  const err = createFsError('EBADF', fd === undefined ? syscall : `${syscall}, fd ${fd}`);
  err.syscall = syscall;
  if (fd !== undefined) {
    err.fd = fd;
  }
  Error.captureStackTrace(err, createEBADF);
  return err;
}

function createEEXIST(syscall, path) {
  const err = createFsError('EEXIST', syscall, path);
  Error.captureStackTrace(err, createEEXIST);
  return err;
}

function createEROFS(syscall, path) {
  const err = createFsError('EROFS', syscall, path);
  Error.captureStackTrace(err, createEROFS);
  return err;
}

function createEINVAL(syscall, path) {
  const err = createFsError('EINVAL', syscall, path);
  Error.captureStackTrace(err, createEINVAL);
  return err;
}

function createELOOP(syscall, path) {
  const err = createFsError('ELOOP', syscall, path);
  Error.captureStackTrace(err, createELOOP);
  return err;
}

class ERR_METHOD_NOT_IMPLEMENTED extends Error {
  constructor(method) {
    super(`The ${method} method is not implemented`);
    this.code = 'ERR_METHOD_NOT_IMPLEMENTED';
  }
}

class ERR_INVALID_STATE extends Error {
  constructor(message) {
    super(`Invalid state: ${message}`);
    this.code = 'ERR_INVALID_STATE';
  }
}

class ERR_INVALID_ARG_TYPE extends TypeError {
  constructor(name, expected, value) {
    super(`The "${name}" argument must be of type ${expected}. Received ${value === null ? 'null' : typeof value}`);
    this.code = 'ERR_INVALID_ARG_TYPE';
  }
}

class ERR_OUT_OF_RANGE extends RangeError {
  constructor(name, range, value) {
    super(`The value of "${name}" is out of range. It must be ${range}. Received ${value}`);
    this.code = 'ERR_OUT_OF_RANGE';
  }
}

class ERR_INVALID_ARG_VALUE extends TypeError {
  constructor(name, value, reason) {
    super(`The argument '${name}' ${reason}. Received ${typeof value === 'string' ? `'${value}'` : String(value)}`);
    this.code = 'ERR_INVALID_ARG_VALUE';
  }
}

module.exports = {
  createENOENT,
  createENOTDIR,
  createENOTEMPTY,
  createEISDIR,
  createEBADF,
  createEEXIST,
  createEROFS,
  createEINVAL,
  createELOOP,
  ERR_METHOD_NOT_IMPLEMENTED,
  ERR_INVALID_STATE,
  ERR_INVALID_ARG_VALUE,
  ERR_OUT_OF_RANGE,
  ERR_INVALID_ARG_TYPE,
};
