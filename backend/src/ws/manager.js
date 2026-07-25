const HEARTBEAT_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

// role -> Set<connectionRecord>
const connectionsByRole = new Map();
// client_id -> connectionRecord (only for sdk_client connections)
const connectionsByClientId = new Map();

function register(socket, user) {
  const record = { socket, user, awaitingPong: false };

  if (!connectionsByRole.has(user.role)) connectionsByRole.set(user.role, new Set());
  connectionsByRole.get(user.role).add(record);

  if (user.role === 'sdk_client' && user.client_id) {
    connectionsByClientId.set(user.client_id, record);
  }

  const heartbeat = setInterval(() => {
    if (record.awaitingPong) {
      // Client missed its pong window — close per spec.
      clearInterval(heartbeat);
      try {
        socket.close(4000, 'heartbeat timeout');
      } catch {
        // socket already closed
      }
      return;
    }
    record.awaitingPong = true;
    try {
      socket.send(JSON.stringify({ event: 'ping', payload: {} }));
    } catch {
      clearInterval(heartbeat);
    }

    setTimeout(() => {
      // Give the client up to PONG_TIMEOUT_MS to reply before the next check.
    }, PONG_TIMEOUT_MS);
  }, HEARTBEAT_INTERVAL_MS);

  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.event === 'pong') record.awaitingPong = false;
    } catch {
      // ignore malformed client messages
    }
  });

  socket.on('close', () => {
    clearInterval(heartbeat);
    connectionsByRole.get(user.role)?.delete(record);
    if (user.role === 'sdk_client' && user.client_id) {
      connectionsByClientId.delete(user.client_id);
    }
  });

  return record;
}

/**
 * Broadcasts an event to all connections whose role is in `audienceRoles`.
 * Pass 'all' to reach every connected socket regardless of role.
 */
function broadcast(event, payload, audienceRoles) {
  const message = JSON.stringify({ event, payload, ts: new Date().toISOString() });

  const roles = audienceRoles === 'all'
    ? Array.from(connectionsByRole.keys())
    : audienceRoles;

  for (const role of roles) {
    const records = connectionsByRole.get(role);
    if (!records) continue;
    for (const record of records) {
      try {
        record.socket.send(message);
      } catch {
        // dead socket, will be cleaned up by its own close handler
      }
    }
  }
}

function sendToClient(clientId, event, payload) {
  const record = connectionsByClientId.get(clientId);
  if (!record) return false;
  try {
    record.socket.send(JSON.stringify({ event, payload, ts: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

const ADMIN_ROOM_ROLES = ['super_admin', 'admin', 'fl_engineer', 'viewer'];

module.exports = { register, broadcast, sendToClient, ADMIN_ROOM_ROLES };
