(function initGTCore(root) {
  const TILE_SIZE = 32;
  const WORLD_STORAGE_PREFIX = "gt_surv_world_v1_";
  const PLAYER_STORAGE_KEY = "gt_surv_player_v1";

  const seedCanvasCache = new Map();

  const G = (root.GTGame = {
    TILE_SIZE,
    canvas: null,
    ctx: null,
    allItems: [],
    itemsById: new Map(),
    allWearables: [],
    wearablesById: new Map(),
    wearableAnimMap: {},

    textures: new Map(),
    loadingTextures: new Set(),

    audioCtx: null,
    audioBuffers: new Map(),

    viewport: { x: 0, y: 0, zoom: 1.8 },
    world: null,
    trees: new Map(),
    damage: new Map(),
    drops: [],
    particles: [],
    floatingTexts: [],

    player: null,
    inventory: [],
    selectedSlot: 0,
    gems: 500,
    hoveredTile: { x: -1, y: -1 }
  });

  /* ─── Auto-Trim Transparent Padding on Official GT Interface Icons ─── */
  G.trimHudIcons = function trimHudIcons() {
    document.querySelectorAll("img[data-trim-src]").forEach((imgEl) => {
      const src = imgEl.getAttribute("data-trim-src");
      if (!src) return;
      const raw = new Image();
      raw.crossOrigin = "anonymous";
      raw.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = raw.naturalWidth;
          c.height = raw.naturalHeight;
          const ctx = c.getContext("2d");
          ctx.drawImage(raw, 0, 0);
          const data = ctx.getImageData(0, 0, c.width, c.height).data;

          let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
          for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
              if (data[(y * c.width + x) * 4 + 3] > 20) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }

          if (maxX >= minX && maxY >= minY) {
            const w = maxX - minX + 1;
            const h = maxY - minY + 1;
            const out = document.createElement("canvas");
            out.width = w;
            out.height = h;
            const octx = out.getContext("2d");
            octx.imageSmoothingEnabled = false;
            octx.drawImage(raw, minX, minY, w, h, 0, 0, w, h);
            imgEl.src = out.toDataURL("image/png");
          }
        } catch (_) {}
      };
      raw.src = src;
    });
  };

  /* ─── Texture & Asset Loader ─── */
  G.loadImage = function loadImage(path) {
    if (!path) return null;
    if (G.textures.has(path)) return G.textures.get(path);
    if (G.loadingTextures.has(path)) return null;
    G.loadingTextures.add(path);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      G.textures.set(path, img);
      G.loadingTextures.delete(path);
    };
    img.onerror = () => {
      G.loadingTextures.delete(path);
    };
    img.src = path;
    return null;
  };

  G.getTilesheet = function getTilesheet(filename) {
    if (!filename) return null;
    return G.loadImage(`tilesheets/${filename}`);
  };

  G.getWeatherImage = function getWeatherImage(weatherId) {
    const cat = root.GTWorldCatalog;
    if (!cat) return null;
    const wObj = cat.getWeatherById(weatherId || "SUNNY");
    if (!wObj || !wObj.file) return null;
    return G.loadImage(`weather/${wObj.file}`);
  };

  /* ─── Audio Engine ─── */
  G.getAudioCtx = function getAudioCtx() {
    if (!G.audioCtx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (AC) G.audioCtx = new AC();
    }
    if (G.audioCtx && G.audioCtx.state === "suspended") {
      G.audioCtx.resume().catch(() => {});
    }
    return G.audioCtx;
  };

  G.playSfx = function playSfx(name, pitch = 1.0, volume = 0.65) {
    const ctx = G.getAudioCtx();
    if (!ctx) return;

    const ext = /\.(wav|ogg|mp3)$/i.test(name) ? "" : ".wav";
    const key = `audio/${name}${ext}`;

    const trigger = (buf) => {
      try {
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        src.buffer = buf;
        src.playbackRate.value = pitch;
        gain.gain.value = volume;
        src.connect(gain);
        gain.connect(ctx.destination);
        src.start(0);
      } catch (_) {}
    };

    if (G.audioBuffers.has(key)) {
      trigger(G.audioBuffers.get(key));
      return;
    }

    fetch(key)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((ab) => (ab ? ctx.decodeAudioData(ab) : null))
      .then((buf) => {
        if (buf) {
          G.audioBuffers.set(key, buf);
          trigger(buf);
        }
      })
      .catch(() => {});
  };

  /* ─── Item Metadata Helpers ─── */
  G.getItem = function getItem(id) {
    return G.itemsById.get(Number(id)) || null;
  };

  G.isSeedItem = function isSeedItem(item) {
    if (!item) return false;
    return Number(item.action) === 19 || item.category === "Seeds";
  };

  G.isWearableItem = function isWearableItem(item) {
    if (!item) return false;
    return G.wearablesById.has(Number(item.id)) || Number(item.action) === 20;
  };

  G.getBlockMaxHits = function getBlockMaxHits(item) {
    if (!item) return 3;
    const id = Number(item.id);
    if (id === 8 || id === 6) return Infinity;
    const name = String(item.name || "").toLowerCase();
    if (name.includes("bedrock") || name.includes("main door")) return Infinity;

    let hits = 3;
    if (name.includes("world lock") || name.includes("diamond lock") || name.includes("blue gem lock") || name.includes("magplant") || name.includes("vending")) hits = 6;
    else if (name.includes("rock") || name.includes("lava") || name.includes("stone") || name.includes("brick")) hits = 5;
    else if (name.includes("wood") || name.includes("platform") || name.includes("door") || name.includes("weather machine")) hits = 4;
    else if (name.includes("grass") || name.includes("flower") || name.includes("daisy")) hits = 2;

    if (typeof G.hasPickaxe === "function" && G.hasPickaxe()) {
      hits = Math.max(1, hits - 1);
    }
    return hits;
  };

  G.getGrowTimeMs = function getGrowTimeMs(seedItem) {
    if (!seedItem) return 15000;
    const id = Number(seedItem.id);
    if (id === 3 || id === 15) return 12000;
    if (id === 5 || id === 11) return 22000;
    return 18000;
  };

  G.getSeedColor = function getSeedColor(itemId) {
    const id = Number(itemId);
    const palette = [
      "#8d5524", "#4ade80", "#f97316", "#94a3b8",
      "#38bdf8", "#facc15", "#c084fc", "#ef4444"
    ];
    return palette[Math.abs(id) % palette.length];
  };

  /* ─── Offscreen 16x16 Tinted Seed Cache ─── */
  function getTintedSeedSprite(seedId) {
    const color = G.getSeedColor(seedId);
    const seedImg = G.getTilesheet("seed.png");
    if (!seedImg || !seedImg.complete || seedImg.naturalWidth === 0) return null;

    if (seedCanvasCache.has(color)) return seedCanvasCache.get(color);

    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 16;
    const cctx = c.getContext("2d");
    cctx.imageSmoothingEnabled = false;
    cctx.drawImage(seedImg, 0, 0, 16, 16, 0, 0, 16, 16);
    cctx.globalCompositeOperation = "source-atop";
    cctx.fillStyle = color;
    cctx.globalAlpha = 0.52;
    cctx.fillRect(0, 0, 16, 16);

    seedCanvasCache.set(color, c);
    return c;
  }

  /* ─── Database Loader ─── */
  G.loadDatabases = async function loadDatabases(onProgress) {
    onProgress(15, "Loading items_db.json...");
    const itemsRes = await fetch("items_db.json");
    G.allItems = await itemsRes.json();
    G.allItems.forEach((it) => {
      if (it && it.id !== undefined) G.itemsById.set(Number(it.id), it);
    });

    onProgress(50, "Loading wearables_manifest.json...");
    try {
      const wRes = await fetch("wearables_manifest.json");
      const wData = await wRes.json();
      G.allWearables = Array.isArray(wData.items) ? wData.items : [];
      G.allWearables.forEach((w) => G.wearablesById.set(Number(w.id), w));
    } catch (e) {
      console.warn("Wearables manifest failed:", e);
    }

    onProgress(68, "Loading wearables_anim_map.json...");
    try {
      const aRes = await fetch("wearables_anim_map.json");
      if (aRes.ok) G.wearableAnimMap = await aRes.json();
    } catch (_) {
      G.wearableAnimMap = {};
    }

    onProgress(80, "Preloading core sprites...");
    G.getTilesheet("tiles_page1.png");
    G.getTilesheet("crack.png");
    G.getTilesheet("seed.png");
    G.getWeatherImage("SUNNY");

    onProgress(92, "Loading world & player data...");
    G.loadPlayerData();
    const lastWorld = localStorage.getItem("gt_surv_last_world") || "START";
    G.enterWorld(lastWorld);
    onProgress(100, "Ready!");
  };

  /* ─── Multi-World Save / Load ─── */
  G.listSavedWorlds = function listSavedWorlds() {
    const names = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(WORLD_STORAGE_PREFIX)) {
        names.push(k.slice(WORLD_STORAGE_PREFIX.length));
      }
    }
    return names.sort();
  };

  G.saveWorld = function saveWorld() {
    if (!G.world) return;
    const key = WORLD_STORAGE_PREFIX + G.world.name.toUpperCase();
    const treesArr = [];
    G.trees.forEach((val, k) => treesArr.push([k, val]));

    const payload = {
      name: G.world.name.toUpperCase(),
      width: G.world.width,
      height: G.world.height,
      weather: G.world.weather || "SUNNY",
      fg: Array.from(G.world.fg),
      bg: Array.from(G.world.bg),
      flags: Array.from(G.world.flags),
      trees: treesArr,
      drops: G.drops.slice(0, 150)
    };
    try {
      localStorage.setItem(key, JSON.stringify(payload));
      localStorage.setItem("gt_surv_last_world", payload.name);
    } catch (e) {
      console.warn("Save world failed:", e);
    }
  };

  G.enterWorld = function enterWorld(rawName, forceReset = false) {
    if (G.world && !forceReset) G.saveWorld();

    const cleanName = String(rawName || "START")
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "")
      .slice(0, 20) || "START";

    const key = WORLD_STORAGE_PREFIX + cleanName;
    const savedRaw = !forceReset ? localStorage.getItem(key) : null;

    G.trees.clear();
    G.damage.clear();
    G.drops = [];
    G.particles = [];

    if (savedRaw) {
      try {
        const data = JSON.parse(savedRaw);
        G.world = {
          name: cleanName,
          width: data.width || 100,
          height: data.height || 60,
          weather: data.weather || "SUNNY",
          fg: new Uint16Array(data.fg),
          bg: new Uint16Array(data.bg),
          flags: new Uint8Array(data.flags)
        };
        if (Array.isArray(data.trees)) {
          const wallNow = Date.now();
          data.trees.forEach(([k, v]) => {
            if (!v) return;
            const growMs = Math.max(1000, Number(v.growMs) || 15000);
            const plantedAt = (Number.isFinite(v.plantedAt) && v.plantedAt > 1e12)
              ? v.plantedAt
              : (wallNow - growMs);
            G.trees.set(k, {
              seedId: Number(v.seedId) || 3,
              blockId: Number(v.blockId) || 2,
              plantedAt,
              growMs
            });
          });
        }
        if (Array.isArray(data.drops)) {
          G.drops = data.drops.map((d, i) => ({
            ...d,
            mustLeave: false,
            canPickupAt: 0,
            bobPhase: Number.isFinite(d.bobPhase) ? d.bobPhase : (i * 1.13)
          }));
        }
      } catch (_) {
        G.world = root.GTWorldCatalog.createStandardWorld(100, 60);
        G.world.name = cleanName;
      }
    } else {
      G.world = root.GTWorldCatalog.createStandardWorld(100, 60);
      G.world.name = cleanName;
    }

    G.getWeatherImage(G.world.weather);
    localStorage.setItem("gt_surv_last_world", cleanName);
    const tagEl = document.getElementById("hud-world-tag");
    if (tagEl) tagEl.textContent = cleanName;

    if (typeof G.respawnPlayer === "function") G.respawnPlayer();
    if (typeof G.addChatLine === "function") {
      G.addChatLine(`World '${cleanName}' entered.`, true);
    }
    G.playSfx("door_open", 1.0, 0.7);
  };

  /* ─── Player Data Save / Load ─── */
  G.savePlayerData = function savePlayerData() {
    const equippedIds = {};
    if (G.player && G.player.equipped) {
      Object.keys(G.player.equipped).forEach((slot) => {
        const eq = G.player.equipped[slot];
        if (eq && eq.id !== undefined) equippedIds[slot] = Number(eq.id);
      });
    }
    const payload = {
      name: G.player ? G.player.name : "Growtopian",
      gems: G.gems,
      inventory: G.inventory,
      equipped: equippedIds,
      skinColor: G.player ? G.player.skinColor : "#ffc3aa"
    };
    try {
      localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {}
  };

  G.loadPlayerData = function loadPlayerData() {
    try {
      const raw = localStorage.getItem(PLAYER_STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (typeof data.gems === "number") G.gems = data.gems;
        if (data.name) G._savedName = String(data.name).slice(0, 16);
        if (Array.isArray(data.inventory) && data.inventory.length >= 2) {
          G.inventory = data.inventory;
          G._savedEquipped = data.equipped || {};
          G._savedSkinColor = data.skinColor || "#ffc3aa";
          return;
        }
      }
    } catch (_) {}

    G.gems = 500;
    G.inventory = [
      { id: 18, qty: 1, permanent: true },
      { id: 32, qty: 1, permanent: true },
      { id: 2, qty: 30 },
      { id: 3, qty: 10 },
      { id: 100, qty: 20 },
      { id: 14, qty: 20 }
    ];
    G._savedEquipped = {};
    G._savedSkinColor = "#ffc3aa";
    G._savedName = "Growtopian";
  };

  /* ─── Tile & Sprite Drawing Helpers ─── */
  G.drawItemIcon = function drawItemIcon(ctx, item, dx, dy, size = 32) {
    if (!item || !item.texture) return;

    if (G.isSeedItem(item)) {
      const tinted = getTintedSeedSprite(item.id);
      if (tinted) {
        ctx.drawImage(tinted, 0, 0, 16, 16, dx, dy, size, size);
      } else {
        ctx.fillStyle = G.getSeedColor(item.id);
        ctx.beginPath();
        ctx.arc(dx + size / 2, dy + size / 2, Math.max(2, size * 0.28), 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    const img = G.getTilesheet(item.texture);
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const sx = (item.tx || 0) * 32;
    const sy = (item.ty || 0) * 32;
    ctx.drawImage(img, sx, sy, 32, 32, dx, dy, size, size);
  };

  G.drawTileAt = function drawTileAt(ctx, item, x, y, layer, isBg) {
    if (!item || !item.texture) return;
    const img = G.getTilesheet(item.texture);
    if (!img || !img.complete || img.naturalWidth === 0) return;

    let offsetX = 0;
    let offsetY = 0;
    const st = Number(item.spread_type) || 0;
    if (root.GTAutotile && [2, 3, 4, 5, 7, 14].includes(st)) {
      const mask = root.GTAutotile.computeNeighborMask(
        layer, G.world.width, G.world.height, x, y, Number(item.id), st === 4
      );
      const off = root.GTAutotile.getTileOffset(item, mask);
      offsetX = off.offsetX || 0;
      offsetY = off.offsetY || 0;
    }

    const sx = (item.tx + offsetX) * TILE_SIZE;
    const sy = (item.ty + offsetY) * TILE_SIZE;
    const destX = x * TILE_SIZE;
    const destY = y * TILE_SIZE;

    if (isBg) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(img, sx, sy, TILE_SIZE, TILE_SIZE, destX, destY, TILE_SIZE, TILE_SIZE);
      ctx.restore();
    } else {
      ctx.drawImage(img, sx, sy, TILE_SIZE, TILE_SIZE, destX, destY, TILE_SIZE, TILE_SIZE);
    }
  };

  /* ─── Render World, Trees, Cracks, Crisp Anti-Jitter Drops & Particles ─── */
  G.renderWorld = function renderWorld(ctx, viewW, viewH, nowMs) {
    if (!G.world) return;
    const w = G.world;
    const vp = G.viewport;
    const wallNow = Date.now();

    const weatherImg = G.getWeatherImage(w.weather);
    if (weatherImg && weatherImg.complete && weatherImg.naturalWidth > 0) {
      const scale = Math.max(viewW / weatherImg.naturalWidth, viewH / weatherImg.naturalHeight);
      const dw = weatherImg.naturalWidth * scale;
      const dh = weatherImg.naturalHeight * scale;
      ctx.drawImage(weatherImg, (viewW - dw) / 2, (viewH - dh) / 2, dw, dh);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, viewH);
      grad.addColorStop(0, "#4ea8de");
      grad.addColorStop(1, "#a9def9");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, viewW, viewH);
    }

    ctx.save();
    // Snap viewport translation to integer screen pixels so sprites never shimmer
    const camX = Math.round(vp.x);
    const camY = Math.round(vp.y);
    ctx.translate(camX, camY);
    ctx.scale(vp.zoom, vp.zoom);
    ctx.imageSmoothingEnabled = false;

    const minX = Math.max(0, Math.floor(-camX / (vp.zoom * TILE_SIZE)) - 1);
    const maxX = Math.min(w.width - 1, Math.ceil((viewW - camX) / (vp.zoom * TILE_SIZE)) + 1);
    const minY = Math.max(0, Math.floor(-camY / (vp.zoom * TILE_SIZE)) - 1);
    const maxY = Math.min(w.height - 1, Math.ceil((viewH - camY) / (vp.zoom * TILE_SIZE)) + 1);

    // 1. Background Layer
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const bgId = w.bg[y * w.width + x];
        if (bgId > 0) G.drawTileAt(ctx, G.getItem(bgId), x, y, w.bg, true);
      }
    }

    // 2. Foreground Layer + Crack Overlay
    const crackImg = G.getTilesheet("crack.png");
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const fgId = w.fg[y * w.width + x];
        if (fgId > 0) G.drawTileAt(ctx, G.getItem(fgId), x, y, w.fg, false);

        const dmg = G.damage.get(`${x},${y}`);
        if (dmg && dmg.hits > 0 && crackImg && crackImg.complete && crackImg.naturalWidth > 0) {
          const ratio = Math.max(0, Math.min(0.99, dmg.hits / dmg.maxHits));
          const frame = Math.min(3, Math.floor(ratio * 4));
          ctx.drawImage(
            crackImg,
            frame * 32, 0, 32, 32,
            x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE
          );
        }
      }
    }

    // 3. Planted Farming Trees
    G.trees.forEach((tree, key) => {
      const [tx, ty] = key.split(",").map(Number);
      if (tx < minX || tx > maxX || ty < minY || ty > maxY) return;
      const growMs = Math.max(1000, Number(tree.growMs) || 15000);
      const plantedAt = (Number.isFinite(tree.plantedAt) && tree.plantedAt > 1e12) ? tree.plantedAt : (wallNow - growMs);
      const prog = Math.max(0, Math.min(1, (wallNow - plantedAt) / growMs));
      const px = tx * TILE_SIZE;
      const py = ty * TILE_SIZE;

      const trunkH = Math.floor(8 + prog * 16);
      ctx.fillStyle = "#6b4226";
      ctx.fillRect(px + 13, py + TILE_SIZE - trunkH, 6, trunkH);

      const crownR = Math.max(2, 5 + prog * 8);
      ctx.fillStyle = prog >= 1 ? "#22c55e" : "#4ade80";
      ctx.beginPath();
      ctx.arc(px + 16, py + TILE_SIZE - trunkH, crownR, 0, Math.PI * 2);
      ctx.fill();

      if (prog >= 1) {
        ctx.fillStyle = G.getSeedColor(tree.seedId);
        ctx.fillRect(px + 10, py + 8, 5, 5);
        ctx.fillRect(px + 18, py + 11, 5, 5);
        ctx.fillRect(px + 13, py + 15, 5, 5);
      }
    });

    // 4. Dropped Items, Seeds & Pixel-Art Gems (HD 22x22 in 26x26 Box + Pixel-Snapped Anti-Jitter)
    for (let i = 0; i < G.drops.length; i++) {
      const d = G.drops[i];
      if (d.x < (minX - 2) * TILE_SIZE || d.x > (maxX + 2) * TILE_SIZE) continue;

      const phase = Number.isFinite(d.bobPhase) ? d.bobPhase : (i * 1.13);
      // Quantize bobbing to 0.5 world-px steps so pixels stay razor sharp and never vibrate
      const bob = Math.round(Math.sin(nowMs * 0.0036 + phase) * 3) * 0.5;
      const drawX = Math.round(d.x);
      const baseY = Math.round(d.y);
      const drawY = baseY + bob;

      // Ground shadow
      ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
      ctx.beginPath();
      ctx.ellipse(drawX, baseY + 11, d.type === "gem" ? 6 : 10, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();

      if (d.type === "gem") {
        const theme = d.qty >= 50 ? "green" : d.qty >= 10 ? "red" : d.qty >= 5 ? "blue" : "yellow";
        if (typeof G.getPixelGemCanvas === "function") {
          const gemCanvas = G.getPixelGemCanvas(theme);
          ctx.drawImage(gemCanvas, 0, 0, 16, 16, drawX - 9, drawY - 9, 18, 18);
        } else {
          ctx.fillStyle = "#facc15";
          ctx.fillRect(drawX - 4, drawY - 4, 8, 8);
        }
      } else {
        const item = G.getItem(d.id);
        // Clean Real GT 26x26 translucent drop frame
        const bx = drawX - 13;
        const by = drawY - 14;
        ctx.fillStyle = "rgba(218, 242, 255, 0.62)";
        ctx.fillRect(bx, by, 26, 26);

        ctx.strokeStyle = "rgba(18, 56, 88, 0.88)";
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, by + 0.5, 25, 25);

        ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
        ctx.strokeRect(bx + 1.5, by + 1.5, 23, 23);

        // Crisp 22x22 item icon inside drop box (avoids 16x16 pixel loss)
        if (item) {
          G.drawItemIcon(ctx, item, bx + 2, by + 2, 22);
        }
        if (d.qty > 1) {
          ctx.font = "bold 9px 'Trebuchet MS', Arial";
          ctx.textAlign = "right";
          ctx.fillStyle = "#000000";
          ctx.fillText(String(d.qty), bx + 25, by + 25);
          ctx.fillText(String(d.qty), bx + 24, by + 24);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(String(d.qty), bx + 24, by + 24.5);
        }
      }
    }

    // 5. Player Avatar
    if (typeof G.drawPlayer === "function") {
      G.drawPlayer(ctx, nowMs);
    }

    // 6. Particles & Floating Text
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const p = G.particles[i];
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    ctx.font = "bold 10px 'Trebuchet MS', Arial";
    ctx.textAlign = "center";
    for (let i = 0; i < G.floatingTexts.length; i++) {
      const ft = G.floatingTexts[i];
      ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
      ctx.fillStyle = "#000";
      ctx.fillText(ft.text, ft.x + 1, ft.y + 1);
      ctx.fillStyle = ft.color || "#ffe666";
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;

    // 7. Hovered Tile Outline
    if (G.hoveredTile.x >= 0 && G.hoveredTile.y >= 0) {
      ctx.strokeStyle = (typeof G.hasRayman === "function" && G.hasRayman())
        ? "rgba(56, 189, 248, 0.75)"
        : "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 1.5 / vp.zoom;
      ctx.strokeRect(G.hoveredTile.x * TILE_SIZE, G.hoveredTile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }

    ctx.restore();
  };
})(window); 