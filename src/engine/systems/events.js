export function createEventQueue(hooks) {
  const pending = [];

  function emit(type, payload) {
    const event = { type, payload, timestamp: Date.now() };
    pending.push(event);
    hooks?.emit?.(`game:${type}`, payload);
    return event;
  }

  return {
    emit,
    drain() {
      const out = pending.splice(0, pending.length);
      return out;
    },
    peek() {
      return [...pending];
    },
  };
}
