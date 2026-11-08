import { ConnectError, Code } from '@connectrpc/connect';

export const invalidArg = (msg) => new ConnectError(msg, Code.InvalidArgument);
export const notFound = (msg) => new ConnectError(msg, Code.NotFound);
export const alreadyExists = (msg) => new ConnectError(msg, Code.AlreadyExists);
export const failedPrecondition = (msg) => new ConnectError(msg, Code.FailedPrecondition);
export const permissionDenied = (msg) => new ConnectError(msg, Code.PermissionDenied);
export const unauthenticated = (msg) => new ConnectError(msg, Code.Unauthenticated);
export const unavailable = (msg) => new ConnectError(msg, Code.Unavailable);
export const resourceExhausted = (msg) => new ConnectError(msg, Code.ResourceExhausted);
export const notImplementedYet = (rpc) => new ConnectError(`${rpc} is part of protocol v1.1 and is not available on this server yet`, Code.Unimplemented);

export function throwIfDeadlineExceeded(signal) {
  if (signal.aborted && signal.reason instanceof ConnectError && signal.reason.code === Code.DeadlineExceeded) {
    throw signal.reason;
  }
}
