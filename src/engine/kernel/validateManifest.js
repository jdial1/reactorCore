const REQUIRED = ['id', 'name', 'tickRate', 'tickRateMs', 'gridDefaults', 'features', 'categories', 'components'];

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Manifest must be an object');
  }

  for (const key of REQUIRED) {
    if (manifest[key] == null) throw new Error(`Manifest missing required field: ${key}`);
  }

  if (!Array.isArray(manifest.components) || manifest.components.length === 0) {
    throw new Error('Manifest must include at least one component');
  }

  const ids = new Set();
  for (const comp of manifest.components) {
    if (!comp.id || !comp.type) throw new Error(`Component missing id or type: ${JSON.stringify(comp)}`);
    if (ids.has(comp.id)) throw new Error(`Duplicate component id: ${comp.id}`);
    ids.add(comp.id);
  }

  if (manifest.unsupportedCapabilities && !Array.isArray(manifest.unsupportedCapabilities)) {
    throw new Error('unsupportedCapabilities must be an array');
  }

  return manifest;
}

export function assertCapability(manifest, capability) {
  if (manifest.unsupportedCapabilities?.includes(capability)) {
    throw new Error(`Capability not supported for ${manifest.id}: ${capability}`);
  }
}
