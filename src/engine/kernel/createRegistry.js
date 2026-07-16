export function createRegistry(createInstanceFn) {
  const byId = new Map();
  const byName = new Map();
  const byExportId = new Map();

  const registry = {
    register: (definition) => {
      byId.set(definition.id, definition);
      if (definition.name) byName.set(definition.name, definition);
      if (definition.exportId != null) byExportId.set(definition.exportId, definition);
    },

    registerAll: (definitions) => {
      for (const def of definitions) registry.register(def);
    },

    get: (idOrExportId) => {
      if (typeof idOrExportId === 'number') return byExportId.get(idOrExportId) || null;
      return byId.get(idOrExportId) || byName.get(idOrExportId) || null;
    },

    create: (idOrExportId) => {
      const def = registry.get(idOrExportId);
      return def ? createInstanceFn(def) : null;
    },

    getAll: () => [...byId.values()],
    getByCategory: (category) => registry.getAll().filter((d) => d.category === category),
  };

  return registry;
}
