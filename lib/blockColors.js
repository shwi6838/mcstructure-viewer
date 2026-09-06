// Placeholder colors so the viewer is readable before we wire up real
// textures from Mojang/bedrock-samples. Matches by substring, so e.g.
// "oak_planks" and "spruce_planks" both hit the "planks" entry.
const COLOR_MAP = {
  grass_block: "#5b8f3c",
  grass: "#5b8f3c",
  dirt: "#7b5a3c",
  stone: "#8d8d8d",
  cobblestone: "#7a7a7a",
  planks: "#b08b5a",
  log: "#6b4a2e",
  leaves: "#4c7a3a",
  sand: "#dcd0a0",
  sandstone: "#d8c98f",
  water: "#3b6fa0",
  glass: "#cfe8f0",
  wool: "#d8d8d8",
  concrete: "#a8a8a8",
  terracotta: "#a15c3e",
  brick: "#9c5b4a",
  quartz: "#e8e2d0",
  gold: "#d4af37",
  iron: "#c9c9c9",
  diamond: "#5fd0d0",
  obsidian: "#1c1424",
  netherrack: "#6b2b2b",
  bedrock: "#333333",
};

// Deterministic fallback color for anything not in the map above, so
// unrecognized blocks still render as something instead of defaulting
// to a single flat gray.
function hashColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 45%, 55%)`;
}

export function colorForBlock(fullName) {
  const name = fullName.replace("minecraft:", "");
  for (const key of Object.keys(COLOR_MAP)) {
    if (name.includes(key)) return COLOR_MAP[key];
  }
  return hashColor(name);
}
