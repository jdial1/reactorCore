import { serializeSession, deserializeSession } from './codecs.js';

export function createSaveCodec({ serializeExtra, deserializeExtra, decodeLegacy, saveVersion = 1, canLoad }) {
  return {
    saveVersion,

    serialize(session) {
      const base = serializeSession(session);
      const extra = serializeExtra?.(session) ?? {};
      return { ...base, ...extra, saveVersion: extra.saveVersion ?? saveVersion };
    },

    deserialize(session, data) {
      deserializeSession(session, data);
      deserializeExtra?.(session, data);
    },

    canLoad(data) {
      if (canLoad) return canLoad(data);
      return data?.saveVersion >= saveVersion;
    },

    decodeLegacy(session, data) {
      if (!decodeLegacy) throw new Error('Legacy save decoding is not supported for this game');
      return decodeLegacy(session, data);
    },

    load(session, data) {
      if (this.canLoad(data)) {
        this.deserialize(session, data);
        return 'versioned';
      }
      if (decodeLegacy && (data?.current_money != null || data?.tiles != null || data?.tiles_compact != null)) {
        decodeLegacy(session, data);
        return 'legacy';
      }
      deserializeSession(session, data);
      return 'generic';
    },
  };
}
