const COMMAND_HANDLERS = new Map();

export function registerCommand(type, handler) {
  COMMAND_HANDLERS.set(type, handler);
}

export function createCommandBus() {
  const queue = [];

  return {
    enqueue(command) {
      if (!command?.type) return false;
      queue.push({ ...command, timestamp: command.timestamp ?? Date.now() });
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

    get pending() {
      return queue.length;
    },
  };
}
