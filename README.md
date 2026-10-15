# mcstructure viewer

A browser-based viewer for Minecraft Bedrock `.mcstructure` files, built with
Next.js, React Three Fiber, and three.js. Drop in a structure exported from a
Structure Block and orbit around it with real block textures and
silhouette-accurate shapes for common non-cube blocks.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:3000/viewer and choose a `.mcstructure` file
(export one from a Structure Block in-game; Bedrock only supports structure
export on Windows).

The scripts use `--webpack` explicitly (`next dev --webpack`,
`next build --webpack`), so the project builds with webpack rather than
Next's default bundler.

> **Needs an internet connection.** Block textures are fetched at runtime from
> [Mojang/bedrock-samples](https://github.com/Mojang/bedrock-samples) on
> GitHub (`raw.githubusercontent.com`). If that fetch fails, the viewer
> falls back to flat colors for every block. Textures intentionally track the
> `main` branch so new blocks and game updates are picked up automatically.

## What's implemented

### Parsing (`lib/parseMcstructure.js`)

- Reads uncompressed, little-endian NBT via `prismarine-nbt`, and provides a
  browser `Buffer` polyfill since the library expects Node's global.
- Extracts `size`, the block palette, and block-index layer 0.
- Decodes Bedrock's index order (`i = sizeZ*sizeY*x + sizeZ*y + z`) into
  `{ x, y, z }` coordinates.
- Skips structure void (`-1`) and `minecraft:air`.
- Keeps each block's `states` (needed for orientation, connections, and
  legacy variant lookup).

### Textures (`lib/blockTextures.js`)

- Fetches `blocks.json` and `textures/terrain_texture.json` from
  bedrock-samples, using a lenient JSON parser that strips `//` comments and
  trailing commas (Mojang's files aren't strict JSON).
- Resolves each block to per-face texture keys (`up`, `down`, `north`,
  `south`, `east`, `west`), handling both single-string and
  `{ up, down, side }` / per-direction `textures` entries.
- Loads only the textures a structure actually uses, each distinct image
  once. PNG is tried first, with a **TGA fallback** (grass, leaves, and a few
  others ship as TGA).
- Packs them into one 16×16-cell **texture atlas** with nearest-neighbor
  filtering, so every textured block shares a single material.
- **Legacy block families** are resolved by state, not just name: the
  `stone_slab`/`stone_slab2/3/4` (and `double_` variants) families, plus
  `leaves`/`leaves2`, map to the correct material texture.
- Biome-tint overlay data is ignored; the base image is used.

### Shapes (`lib/blockShapes.js`)

Blocks are classified by name into shape families; everything else is a full
cube. These are silhouette approximations, not exact copies of Bedrock's
block models.

| Category | Notes |
| --- | --- |
| Full cube | Default; `pillar_axis` rotates logs, basalt, etc. |
| Slab | Top/bottom half via `minecraft:vertical_half` |
| Stairs | `weirdo_direction` + `upside_down_bit` |
| Trapdoor | `direction`, `open_bit`, `upside_down_bit` |
| Door | Thin panel oriented by `minecraft:cardinal_direction` |
| Fence gate | Posts, rails, and middle post; `open_bit` rotates it |
| Fences, walls, panes, iron bars | Center post plus arms for each connected side |
| Button | Wall, floor, and ceiling placements via `facing_direction` |
| Ladder | Thin panel against the wall it's mounted on |
| Torch | Small upright post |
| Rail, carpet | Flat slab, no orientation |
| Cross plants | Saplings, flowers, ferns, wheat, etc. as two crossed planes (double-sided, `alphaTest`) |

Fence, wall, and pane connections come from the block's own connection
states when present (`minecraft:connection_*`, `wall_connection_type_*`),
and fall back to "is there a neighbor block on that side" for older blocks.

### Rendering (`components/StructureViewer.jsx`)

- Blocks are grouped by shape category, orientation, connection pattern, and
  exact UV set. Each group is one `InstancedMesh`, which keeps draw calls low
  even for large builds.
- Blocks with no resolved texture render as flat-colored cubes
  (`lib/blockColors.js`: substring color map plus a deterministic hashed
  color for unknown names).
- The info panel shows block count, dimensions, how many blocks are
  textured vs. shown as color, and a toggle listing the untextured block
  names by frequency, which is useful for deciding which blocks to support
  next.
- Orbit camera via `@react-three/drei`'s `OrbitControls`.

### App shell

- `app/page.js`: placeholder home page ("My Bedrock builds") linking to the
  viewer; intended to become a gallery of saved builds.
- `app/viewer/page.js`: client component that loads the viewer with
  `dynamic(..., { ssr: false })`, since three.js needs the browser.
- `app/layout.js`: root layout and metadata.

## Project structure

```
app/
  layout.js
  page.js
  viewer/
    page.js              # route entry; renders StructureViewer (ssr: false)
components/
  StructureViewer.jsx    # canvas, file input, grouping, instancing, UI panel
lib/
  parseMcstructure.js    # NBT -> { size, blocks }
  blockTextures.js       # fetch textures, build atlas, resolve face UVs
  blockShapes.js         # shape categories and geometry builders
  blockColors.js         # flat-color fallback
```

## Known limitations

**Not yet supported**

- **Layer 0 only.** The second layer (mostly waterlogging data) is ignored,
  so waterlogged blocks and water-in-layer-1 won't appear.
- **No block entities.** Chests, signs, banners, and similar data in
  `block_position_data` isn't read.
- **No auto-framing.** The camera starts at a fixed position instead of
  fitting the structure's bounding box.
- **No biome tinting.** Grass and leaves use the untinted base texture.
- **No face culling or transparency sorting.** Every block face is drawn, and
  translucent blocks such as glass and water use `alphaTest` cutout rather
  than true blending.

**Shape simplifications**

- Doors ignore hinge side and open state; only the facing is used.
- Rails are always flat (no curves, slopes, or powered/detector variants).
- Torches are always upright; wall-mounted torches aren't tilted.
- Stairs are always straight; no inner/outer corner shapes.
- Neighbor-based connection fallback treats *any* adjacent block as
  connectable rather than following vanilla rules.
- Many other non-cube blocks (beds, chests, heads, lanterns, anvils, etc.)
  render as full cubes.
- Rotations for some blocks (notably doors and fence gates) may still need
  tuning; these and other per-block details will be fixed over time.

**Technical caveats**

- Textures track the `main` branch of bedrock-samples. An upstream rename
  could move a block into the untextured list; the "show untextured block
  names" toggle is the way to spot that.
- The comment stripper in `blockTextures.js` removes everything after `//` on
  each line, which would break a string value containing `//` (none known
  today).
- Blockstate names vary by game version (the palette's `version` field).
  If a block looks wrong, check it against a known-simple structure.
- The viewer expects an uncompressed `.mcstructure`.

## Goals

The project is planned as two parts built on a shared core.

```
lib/                      shared core engine (parsing, textures, shapes, colors)
components/StructureViewer.jsx   shared React viewer component
        │
        ├── Workshop (local Next.js app)   upload, debug, gallery, texture uploads
        └── Embeddable viewer (npm)        index.js (React) + web-component.js (CDN)
```

### 1. Workshop (local Next.js app)

A local tool for uploading, inspecting, and cataloguing builds:

- Upload `.mcstructure` files and preview them, with stats and the
  untextured block checks.
- **Texture uploads:** add resource/addon pack textures so modded blocks can
  be previewed. Files are read locally in the browser.
- **Gallery** of saved builds stored in **IndexedDB**, with an optional cloud
  sync (sharing/publishing builds) later.
- Generic placeholders for modded or unknown blocks.

### 2. Embeddable viewer (npm package)

Two entry points share the same component:

- `index.js`: native React export for npm + React projects. React, three.js,
  React Three Fiber, and drei are **external peer dependencies**, so host
  sites don't get duplicate copies.
- `web-component.js`: wraps the component with `@r2wc/react-to-web-component`
  (Shadow DOM) as `<mcbe-structure-viewer>`, fully self-contained for use
  from a `<script>` CDN tag on any site.

A single `vite.config.js` dual-builds both (ES module + IIFE for the web
component).

```html
<mcbe-structure-viewer src="/builds/castle.mcstructure"></mcbe-structure-viewer>
```

### 3. Hosting and assets

- **Workshop:** users upload their own structure files and resource/addon
  packs locally; nothing is sent to a server.
- **Web component:** site owners host their own structure files; visitors
  load their own resource/addon packs on their side if they want custom
  textures.
- This project does not host or redistribute Mojang textures or third-party
  packs. Vanilla textures are fetched at runtime from bedrock-samples.
- Licensing and Mojang attribution to be completed before the first release.

### 4. Viewer improvements

- Auto-fit the camera to the structure's bounding box.
- Read layer 1 for waterlogging and render water.
- Hidden-face culling for large builds.
- Biome tinting for grass and foliage.
- More block shapes and texture mappings, prioritized from the untextured
  block list.

Detailed planning notes live in [`PLANNING.txt`](./PLANNING.txt).