export function createHookBus() {
  const listeners = new Map();

  const bus = {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
      return () => bus.off(event, fn);
    },

    off: (event, fn) => {
      const list = listeners.get(event);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },

    emit: (event, ctx) => {
      const list = listeners.get(event);
      if (!list) return;
      for (const fn of list) fn(ctx);
    },
  };

  return bus;
}
