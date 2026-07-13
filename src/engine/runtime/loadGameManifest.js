import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateManifest } from '../kernel/validateManifest.js';

const GAME_DATA_FILES = ['data.json', 'parts.json', 'upgrades.json', 'research.json'];

function mergeResearch(manifest, research) {
  if (!research || typeof research !== 'object') return manifest;
  if (research.techTree != null) manifest.techTree = research.techTree;
  if (research.objectives != null) manifest.objectives = research.objectives;
  if (research.achievements != null) manifest.achievements = research.achievements;
  if (research.difficulty != null) manifest.difficulty = research.difficulty;
  if (research.presentation != null) manifest.presentation = research.presentation;
  return manifest;
}

export function composeGameManifest(base, parts, upgrades, research) {
  const manifest = { ...base };
  if (parts != null) {
    manifest.components = parts.components ?? (Array.isArray(parts) ? parts : []);
  }
  if (upgrades != null) {
    manifest.upgrades = upgrades.upgrades ?? upgrades;
  }
  return mergeResearch(manifest, research);
}

async function readJsonFile(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

async function tryReadJson(path) {
  try {
    return await readJsonFile(path);
  } catch {
    return null;
  }
}

export async function loadGameManifestFromDir(gameDir) {
  const base = await readJsonFile(join(gameDir, 'data.json'));
  const parts = await tryReadJson(join(gameDir, 'parts.json'));
  const upgrades = await tryReadJson(join(gameDir, 'upgrades.json'));
  const research = await tryReadJson(join(gameDir, 'research.json'));
  const fallbackResearch = {
    techTree: base.techTree,
    objectives: base.objectives,
    achievements: base.achievements,
    difficulty: base.difficulty,
    presentation: base.presentation,
  };
  const manifest = composeGameManifest(
    base,
    parts ?? (base.components != null ? { components: base.components } : null),
    upgrades ?? base.upgrades ?? null,
    research ?? fallbackResearch,
  );
  return validateManifest(manifest);
}

export async function loadGameManifest(gameId, options = {}) {
  const gamesRoot = options.gamesRoot ?? join(dirname(fileURLToPath(import.meta.url)), '../../games');
  return loadGameManifestFromDir(join(gamesRoot, gameId));
}

export async function fetchGameManifest(gameId, baseUrl) {
  const base = await (await fetch(`${baseUrl}/data.json`)).json();
  let parts = null;
  let upgrades = null;
  let research = null;
  for (const [file, slot] of [
    ['parts.json', 'parts'],
    ['upgrades.json', 'upgrades'],
    ['research.json', 'research'],
  ]) {
    try {
      const response = await fetch(`${baseUrl}/${file}`);
      if (!response.ok) continue;
      const data = await response.json();
      if (slot === 'parts') parts = data;
      if (slot === 'upgrades') upgrades = data;
      if (slot === 'research') research = data;
    } catch {
      continue;
    }
  }
  return validateManifest(composeGameManifest(
    base,
    parts ?? (base.components != null ? { components: base.components } : null),
    upgrades ?? base.upgrades ?? null,
    research ?? {
      techTree: base.techTree,
      objectives: base.objectives,
      achievements: base.achievements,
      difficulty: base.difficulty,
      presentation: base.presentation,
    },
  ));
}

export { GAME_DATA_FILES };
