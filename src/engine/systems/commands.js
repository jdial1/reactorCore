const COMMAND_HANDLERS = new Map();

export function registerCommand(type, handler) {
  COMMAND_HANDLERS.set(type, handler);
}

export function normalizeCommand(command) {
  if (!command || typeof command !== 'object') return null;
  const type = command.type || command.action;
  if (!type) return null;
  const payload = { ...(command.payload || {}) };
  if (payload.id == null && payload.partId != null) payload.id = payload.partId;
  if (payload.id == null && payload.upgradeId != null) payload.id = payload.upgradeId;
  return {
    type,
    payload,
    timestamp: command.timestamp ?? Date.now(),
  };
}

export function createCommandBus() {
  const queue = [];

  return {
    enqueue(command) {
      const normalized = normalizeCommand(command);
      if (!normalized) return false;
      queue.push(normalized);
      return true;
    },

    drain(session) {
      const applied = [];
      while (queue.length) {
        const command = queue.shift();
        const handler = COMMAND_HANDLERS.get(command.type);
        if (!handler) continue;
        const result = handler(session, command.payload ?? {});
        applied.push({ type: command.type, result });
      }
      return applied;
    },

    peek() {
      return queue.map((command) => ({
        type: command.type,
        payload: command.payload,
        timestamp: command.timestamp,
      }));
    },

    clear() {
      queue.length = 0;
    },

    hasPendingOfTypes(types) {
      if (!types || queue.length === 0) return false;
      const set = types instanceof Set ? types : new Set(types);
      for (let i = 0; i < queue.length; i++) {
        if (set.has(queue[i].type)) return true;
      }
      return false;
    },

    get pending() {
      return queue.length;
    },
  };
}
