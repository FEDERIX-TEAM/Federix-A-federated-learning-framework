import { ConnectError, Code } from '@connectrpc/connect';

export const invalidArg = (msg) => new ConnectError(msg, Code.InvalidArgument);
export const notFound = (msg) => new ConnectError(msg, Code.NotFound);
export const alreadyExists = (msg) => new ConnectError(msg, Code.AlreadyExists);
export const failedPrecondition = (msg) => new ConnectError(msg, Code.FailedPrecondition);
export const permissionDenied = (msg) => new ConnectError(msg, Code.PermissionDenied);
export const unauthenticated = (msg) => new ConnectError(msg, Code.Unauthenticated);
export const unavailable = (msg) => new ConnectError(msg, Code.Unavailable);
