(function initGTPlayer(root) {
  const G = root.GTGame;
  if (!G) return;

  const TILE = G.TILE_SIZE;

  const BASE_SET = {
    tanganKanan: "Base Set GT/Tangan Kanan.png",
    kakiKiri:    "Base Set GT/Kaki Kiri.png",
    kakiKanan:   "Base Set GT/Kaki Kanan.png",
    body:        "Base Set GT/Body.png",
    bodyNaked:   "Base Set GT/Body Naked.png",
    bolaMata:    "Base Set GT/Bola Mata.png",
    pupil:       "Base Set GT/Pupil.png",
    headBolong:  "Base Set GT/Head Bolong.png",
    mulut:       "Base Set GT/Mulut.png",
    tutupMata:   "Base Set GT/Tutup Mata.png",
    tanganKiri:  "Base Set GT/Tangan Kiri.png",
    fist:        "character_base_assets/gt_parts/gt_punch_fist.png"
  };

  const tintCache = new Map();
  const gemSpriteCache = new Map();
  G.weaponEffects = [];

  // Integrasi langsung dengan avatar_positioning.js dari repo
  let customPositionState = root.AvatarPositioning
    ? root.AvatarPositioning.load(root.localStorage)
    : { version: 2, positions: {} };

  G.getItemCustomOffset = function getItemCustomOffset(slot, itemId) {
    if (root.AvatarPositioning) {
      return root.AvatarPositioning.getOffset(customPositionState, slot, itemId);
    }
    return { x: 0, y: 0 };
  };

  G.nudgeItemCustomOffset = function nudgeItemCustomOffset(slot, itemId, dx, dy) {
    if (!root.AvatarPositioning) return { x: 0, y: 0 };
    const cur = root.AvatarPositioning.getOffset(customPositionState, slot, itemId);
    customPositionState = root.AvatarPositioning.setOffset(
      customPositionState,
      slot,
      itemId,
      { x: cur.x + dx, y: cur.y + dy }
    );
    root.AvatarPositioning.save(root.localStorage, customPositionState);
    G.renderMiniAvatar(performance.now());
    return root.AvatarPositioning.getOffset(customPositionState, slot, itemId);
  };

  G.resetItemCustomOffset = function resetItemCustomOffset(slot, itemId) {
    if (!root.AvatarPositioning) return { x: 0, y: 0 };
    customPositionState = root.AvatarPositioning.resetOffset(customPositionState, slot, itemId);
    root.AvatarPositioning.save(root.localStorage, customPositionState);
    G.renderMiniAvatar(performance.now());
    return { x: 0, y: 0 };
  };

  function isReady(img) {
    return Boolean(img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
  }

  /* ─── Authentic 16x16 Pixel-Art Growtopia Gem Logo & Drop Sprite ─── */
  const GEM_PALETTES = {
    cyan:   { dark: "#0369a1", mid: "#0ea5e9", light: "#38bdf8", shine: "#e0f2fe" },
    yellow: { dark: "#a16207", mid: "#eab308", light: "#fde047", shine: "#fefce8" },
    blue:   { dark: "#1d4ed8", mid: "#3b82f6", light: "#60a5fa", shine: "#dbeafe" },
    red:    { dark: "#991b1b", mid: "#ef4444", light: "#f87171", shine: "#fee2e2" },
    green:  { dark: "#166534", mid: "#22c55e", light: "#4ade80", shine: "#dcfce7" }
  };

  const GEM_MAP = [
    "....OOOO....",
    "...OSSSSO...",
    "..OSLLLLSO..",
    ".OSLLMMLLSO.",
    "OSLMMMMMMLSO",
    "OLLMDDDDMMLO",
    "OLLMDDDDMMLO",
    "ODLMMMMMMLDO",
    ".ODLLMMLLDO.",
    "..ODLLLLDO..",
    "...ODDDDO...",
    "....OOOO...."
  ];

  G.getPixelGemCanvas = function getPixelGemCanvas(theme = "cyan") {
    const pal = GEM_PALETTES[theme] || GEM_PALETTES.cyan;
    if (gemSpriteCache.has(theme)) return gemSpriteCache.get(theme);

    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    for (let y = 0; y < GEM_MAP.length; y++) {
      const row = GEM_MAP[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === ".") continue;
        if (ch === "O") ctx.fillStyle = "#081420";
        else if (ch === "S") ctx.fillStyle = pal.shine;
        else if (ch === "L") ctx.fillStyle = pal.light;
        else if (ch === "M") ctx.fillStyle = pal.mid;
        else if (ch === "D") ctx.fillStyle = pal.dark;
        ctx.fillRect(x + 2, y + 2, 1, 1);
      }
    }
    gemSpriteCache.set(theme, c);
    return c;
  };

  G.renderStaticGemIcons = function renderStaticGemIcons() {
    const gemImg = G.getPixelGemCanvas("cyan");
    ["hud-gem-icon", "store-gem-icon"].forEach((id) => {
      const c = document.getElementById(id);
      if (!c) return;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(gemImg, 0, 0, c.width, c.height);
    });
  };

  function hexToRgb(hex) {
    let c = String(hex || "#f0f0f0").replace("#", "");
    if (c.length === 3) c = c.split("").map((x) => x + x).join("");
    const n = parseInt(c, 16);
    if (Number.isNaN(n)) return { r: 240, g: 240, b: 240 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function getTintedPart(path, colorHex) {
    const img = G.loadImage(path);
    if (!isReady(img)) return null;
    if (!colorHex || colorHex.toLowerCase() === "#ffffff") return img;

    const key = `${path}|${colorHex.toLowerCase()}`;
    if (tintCache.has(key)) return tintCache.get(key);

    try {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      const tctx = c.getContext("2d");
      tctx.imageSmoothingEnabled = false;
      tctx.drawImage(img, 0, 0, 32, 32);

      const imgData = tctx.getImageData(0, 0, 32, 32);
      const d = imgData.data;
      const rgb = hexToRgb(colorHex);
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 0) {
          d[i]     = Math.min(255, Math.floor((d[i] / 255) * rgb.r));
          d[i + 1] = Math.min(255, Math.floor((d[i + 1] / 255) * rgb.g));
          d[i + 2] = Math.min(255, Math.floor((d[i + 2] / 255) * rgb.b));
        }
      }
      tctx.putImageData(imgData, 0, 0);
      tintCache.set(key, c);
      return c;
    } catch (_) {
      return img;
    }
  }

  const player = (G.player = {
    name: "Growtopian",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    width: 20,
    height: 28,
    facing: 1,
    isGrounded: false,
    isClimbing: false,
    isDead: false,
    deathTimer: 0,
    invincibleTimer: 0,

    jumpCount: 0,
    jumpConsumed: false,
    glideSoundTimer: 0,
    backFxTimer: 0,

    animTimer: 0,
    walkPhase: 0,

    punchTimer: 0,
    punchMaxTimer: 0.22,
    punchTargetX: 0,
    punchTargetY: 0,
    punchCooldown: 0,

    chatText: "",
    chatTimer: 0,

    skinColor: G._savedSkinColor || "#ffc3aa",
    equipped: {
      Back: null,
      Artifact: null,
      Feet: null,
      Pants: null,
      Shirt: null,
      Chest: null,
      Face: null,
      Hair: null,
      Hat: null,
      Hand: null
    },

    keys: {
      left: false,
      right: false,
      up: false,
      down: false,
      jump: false,
      punch: false
    }
  });

  Object.values(BASE_SET).forEach((p) => G.loadImage(p));

  /* ─── Hand Weapon Classifier & Theme Color Engine ─── */
  function getWeaponThemeColor(name, type) {
    const n = name.toLowerCase();
    if (/apocalypse|poison|venom|toxic|acid|emerald|jade|green|nature|zombie|slime|plague/.test(n)) return "#4ade80";
    if (/fire|flame|lava|inferno|blood|crimson|ruby|red|demon|devil|magma|phoenix|hell/.test(n)) return "#f97316";
    if (/ice|frost|snow|diamond|aqua|water|blue|crystal|cyber|laser|raym|r.yman|plasma|tesla/.test(n)) return "#38bdf8";
    if (/shadow|dark|void|night|purple|violet|cosmic|nebula|phantom|soul|reaper|amethyst/.test(n)) return "#c084fc";
    if (/gold|royal|angel|sun|holy|light|lightning|thunder|star|yellow|zeus/.test(n)) return "#fde047";
    if (type === "blade") return "#e0f2fe";
    if (type === "magic") return "#c084fc";
    if (type === "ranged") return "#38bdf8";
    if (type === "tool") return "#fde047";
    if (type === "rayman") return "#38bdf8";
    return "#ffffff";
  }

  G.getHandWeaponInfo = function getHandWeaponInfo() {
    const item = player.equipped.Hand;
    if (!item) return { item: null, type: "none", color: "#ffffff", sub: "bare" };

    const id = Number(item.id);
    const n = String(item.name || "").toLowerCase();

    // 1. Rayman's Fist (ID 5480 + regex kebal typo)
    if (id === 5480 || /raym|r.yman/.test(n)) {
      return { item, type: "rayman", color: "#38bdf8", sub: "rayman" };
    }

    // 2. Mining / Chopping Tools
    if (/pickaxe|pick\b|chainsaw|drill|jackhammer|shovel|axe\b|hatchet|hammer|mallet|crowbar|saw\b|hoe\b/.test(n)) {
      return { item, type: "tool", color: getWeaponThemeColor(n, "tool"), sub: "tool" };
    }

    // 3. Ranged Weapons (Guns, Lasers, Bows)
    if (/gun|rifle|ak-|blaster|laser|bow\b|crossbow|cannon|pistol|sniper|bazooka|shotgun|musket|launcher|phaser|zapper|turret|revolver/.test(n)) {
      const sub = /bow/.test(n) ? "bow" : (/laser|blaster|phaser|plasma|zapper|cyber/.test(n) ? "laser" : "gun");
      return { item, type: "ranged", color: getWeaponThemeColor(n, "ranged"), sub };
    }

    // 4. Blades & Polearms (Swords, Scythes, Katanas, Spears)
    if (/sword|scythe|katana|blade|dagger|spear|saber|sabre|knife|cleaver|halberd|glaive|rapier|claymore|lance|sickle|machete|trident|excalibur/.test(n)) {
      const sub = /scythe|claymore|halberd|glaive/.test(n) ? "heavy" : "fast";
      return { item, type: "blade", color: getWeaponThemeColor(n, "blade"), sub };
    }

    // 5. Magic Weapons (Wands, Staves, Elemental)
    if (/wand|staff|scepter|sceptre|rod\b|tome|spell|grimoire|orb\b|flame|fire|ice|frost|lightning|thunder|arcane|mystic|wizard|mage/.test(n)) {
      const sub = /fire|flame|lava/.test(n) ? "fire" : (/ice|frost|snow/.test(n) ? "ice" : (/lightning|thunder|zap/.test(n) ? "lightning" : "arcane"));
      return { item, type: "magic", color: getWeaponThemeColor(n, "magic"), sub };
    }

    // 6. Gloves / Fists / Claws
    if (/fist|glove|claw|knuckle|gauntlet|boxing|paw\b|hand\b/.test(n)) {
      return { item, type: "fist", color: getWeaponThemeColor(n, "fist"), sub: "fist" };
    }

    // 7. Any Other Hand Item (Briefcase, Leash, Whip, Umbrella, etc.)
    return { item, type: "generic", color: getWeaponThemeColor(n, "generic"), sub: "generic" };
  };

  /* ─── Back Item Classification ─── */
  G.getBackAnimStyle = function getBackAnimStyle() {
    const back = player.equipped.Back;
    if (!back) return "none";
    const n = String(back.name || "").toLowerCase();

    if (/jetpack|rocket|airplane|plane|thruster|mech|booster|turbine|copter|propeller|cyber|space/.test(n)) {
      return "jetpack";
    }
    if (/cape|cloak|scarf|mantle|shawl|tail|backpack|quiver|banner|flag/.test(n)) {
      return "cape";
    }
    if (/fairy|butterfly|bee|moth|pixie|firefly|dragonfly|aurora|rainbow|crystal|star/.test(n)) {
      return "fairy";
    }
    if (/demon|dragon|bat|devil|vinci|phoenix|hawk|eagle|griffin/.test(n)) {
      return "heavy_wings";
    }
    return "wings";
  };

  G.hasWings = function hasWings() {
    return Boolean(player.equipped.Back);
  };

  /* ─── Special Wearable Powers ─── */
  G.hasRayman = function hasRayman() {
    return G.getHandWeaponInfo().type === "rayman";
  };

  G.hasPickaxe = function hasPickaxe() {
    return G.getHandWeaponInfo().type === "tool";
  };

  G.hasSpeedGear = function hasSpeedGear() {
    const slots = [player.equipped.Feet, player.equipped.Pants, player.equipped.Hand];
    return slots.some((it) => {
      if (!it) return false;
      const n = String(it.name || "").toLowerCase();
      return /air robinson|speedy|skate|roller|hoverboard|sonic|cheetah/.test(n);
    });
  };

  G.hasHighJumpGear = function hasHighJumpGear() {
    const feet = player.equipped.Feet;
    if (!feet) return false;
    const n = String(feet.name || "").toLowerCase();
    return /air robinson|spring|kangaroo|moon/.test(n);
  };

  /* ─── Restore Saved Name & Wearables ─── */
  G.restorePlayerEquipment = function restorePlayerEquipment() {
    if (G._savedName) player.name = G._savedName;
    if (G._savedSkinColor) player.skinColor = G._savedSkinColor;

    const nameEl = document.getElementById("hud-player-name");
    if (nameEl) nameEl.textContent = player.name;

    const saved = G._savedEquipped || {};
    Object.keys(player.equipped).forEach((slot) => {
      const id = saved[slot];
      if (id) {
        const w = G.wearablesById.get(Number(id));
        player.equipped[slot] = w || null;
        if (w && w.texture) G.getTilesheet(w.texture);
      } else {
        player.equipped[slot] = null;
      }
    });

    G.renderStaticGemIcons();
    G.renderMiniAvatar(performance.now());
  };

  /* ─── Equip / Unequip Wearable ─── */
  G.isItemEquipped = function isItemEquipped(itemId) {
    const id = Number(itemId);
    return Object.values(player.equipped).some((eq) => eq && Number(eq.id) === id);
  };

  G.toggleEquipItem = function toggleEquipItem(itemId) {
    const id = Number(itemId);
    const wearable = G.wearablesById.get(id);
    if (!wearable || !wearable.slot) return false;

    const slot = wearable.slot;
    if (!Object.prototype.hasOwnProperty.call(player.equipped, slot)) return false;

    const current = player.equipped[slot];
    if (current && Number(current.id) === id) {
      player.equipped[slot] = null;
      if (typeof G.addChatLine === "function") {
        G.addChatLine(`Unequipped ${wearable.name}.`, true);
      }
    } else {
      player.equipped[slot] = wearable;
      if (wearable.texture) G.getTilesheet(wearable.texture);
      if (typeof G.addChatLine === "function") {
        let buff = "";
        if (slot === "Hand") {
          const info = G.getHandWeaponInfo();
          if (info.type === "rayman") buff = " (3-Tile Punch & Place!)";
          else if (info.type === "tool") buff = " (Mining Swing + Faster Break!)";
          else if (info.type === "blade") buff = " (Slash Effect!)";
          else if (info.type === "ranged") buff = " (Ranged Shot Effect!)";
          else if (info.type === "magic") buff = " (Magic Cast Effect!)";
        } else if (slot === "Back") {
          const st = G.getBackAnimStyle();
          if (st === "jetpack") buff = " (Jetpack Boost + Glide!)";
          else if (st === "cape") buff = " (Double Jump + Glide!)";
          else buff = " (Double Jump + Wing Flap!)";
        } else if (String(wearable.name || "").toLowerCase().includes("air robinson")) {
          buff = " (Speed + High Jump!)";
        }
        G.addChatLine(`Equipped ${wearable.name}${buff}`, true);
      }
    }

    G.playSfx("change_clothes", 1.0, 0.7);
    G.savePlayerData();
    G.renderMiniAvatar(performance.now());
    return true;
  };

  /* ─── Tile Collision Classification ─── */
  G.isDoorTile = function isDoorTile(item) {
    if (!item) return false;
    const act = Number(item.action);
    const name = String(item.name || "").toLowerCase();
    if ([1, 2, 13, 26, 43, 84, 104, 105, 106, 142].includes(act)) return true;
    return name.includes("door") || name.includes("portal") || name.includes("entrance") || name.includes("gate");
  };

  G.isClimbableTile = function isClimbableTile(item) {
    if (!item) return false;
    const act = Number(item.action);
    const name = String(item.name || "").toLowerCase();
    return act === 134 || name.includes("ladder") || name.includes("vine") || name.includes("rope") || name.includes("chain");
  };

  G.isPlatformTile = function isPlatformTile(item) {
    if (!item) return false;
    if (G.isClimbableTile(item)) return false;
    const act = Number(item.action);
    const name = String(item.name || "").toLowerCase();
    return act === 21 || name.includes("platform") || name.includes("bridge") || name.includes("cloud");
  };

  G.isHazardTile = function isHazardTile(item) {
    if (!item) return false;
    const act = Number(item.action);
    const name = String(item.name || "").toLowerCase();
    return act === 16 || name.includes("lava") || name.includes("spike") || name.includes("deathtrap");
  };

  G.isBouncyTile = function isBouncyTile(item) {
    if (!item) return false;
    const id = Number(item.id);
    const act = Number(item.action);
    const name = String(item.name || "").toLowerCase();
    return id === 194 || id === 526 || id === 624 || act === 24 || name.includes("mushroom") || name.includes("pinball") || name.includes("trampoline");
  };

  G.isSolidTile = function isSolidTile(item) {
    if (!item || Number(item.id) === 0) return false;
    if (G.isDoorTile(item) || G.isClimbableTile(item) || G.isPlatformTile(item)) return false;
    const act = Number(item.action);
    const name = String(item.name || "").toLowerCase();
    if ([0, 1, 2, 3, 6, 10, 13, 18, 19, 21, 27, 28, 81, 89, 134].includes(act)) return false;
    if (name.includes("sign") || name.includes("torch") || name.includes("flower") || name.includes("daisy") || name.includes("rose") || name.includes("grass")) {
      if (!name.includes("block")) return false;
    }
    return true;
  };

  /* ─── Spawn & Death ─── */
  G.findSpawnPoint = function findSpawnPoint() {
    const w = G.world;
    if (!w) return { x: 1600, y: 600 };

    for (let y = 0; y < w.height; y++) {
      for (let x = 0; x < w.width; x++) {
        if (w.fg[y * w.width + x] === 6) {
          return { x: x * TILE + 6, y: y * TILE + 4 };
        }
      }
    }
    return { x: Math.floor(w.width / 2) * TILE + 6, y: Math.floor(w.height * 0.35) * TILE };
  };

  G.respawnPlayer = function respawnPlayer() {
    const sp = G.findSpawnPoint();
    player.x = sp.x;
    player.y = sp.y;
    player.vx = 0;
    player.vy = 0;
    player.isDead = false;
    player.deathTimer = 0;
    player.invincibleTimer = 1.2;
    player.jumpCount = 0;
    player.jumpConsumed = false;
  };

  G.killPlayer = function killPlayer(reason) {
    if (player.isDead || player.invincibleTimer > 0) return;
    player.isDead = true;
    player.deathTimer = 0.75;
    player.vx = -player.facing * 2.5;
    player.vy = -6.5;
    G.playSfx("boo_death", 1.0, 0.75);
    G.playSfx("ouch", 1.0, 0.7);
    if (reason && typeof G.addChatLine === "function") {
      G.addChatLine(reason, true);
    }
  };

  /* ─── Spawn Hand Weapon Attack VFX & Audio ─── */
  function spawnWeaponAttackVfx(tx, ty) {
    const info = G.getHandWeaponInfo();
    if (info.type === "none") return;

    const sx = player.x + player.width / 2 + player.facing * 12;
    const sy = player.y + player.height / 2 + 2;
    const ex = tx * TILE + TILE / 2;
    const ey = ty * TILE + TILE / 2;
    const ang = Math.atan2(ey - sy, ex - sx);

    if (info.type === "blade") {
      G.weaponEffects.push({
        kind: "slash",
        x: ex,
        y: ey,
        angle: ang,
        facing: player.facing,
        color: info.color,
        radius: info.sub === "heavy" ? 22 : 17,
        life: 0.2,
        maxLife: 0.2
      });
      G.playSfx(info.sub === "heavy" ? "slash" : "slashquick", 0.95 + Math.random() * 0.12, 0.55);
      for (let i = 0; i < 4; i++) {
        G.particles.push({
          x: ex + (Math.random() - 0.5) * 14,
          y: ey + (Math.random() - 0.5) * 14,
          vx: Math.cos(ang) * (1.2 + Math.random() * 2),
          vy: Math.sin(ang) * (1.2 + Math.random() * 2) - 0.6,
          color: info.color,
          size: 3,
          life: 0.24,
          maxLife: 0.24
        });
      }
    } else if (info.type === "ranged") {
      G.weaponEffects.push({
        kind: info.sub === "bow" ? "bolt" : "beam",
        x1: sx,
        y1: sy,
        x2: ex,
        y2: ey,
        color: info.color,
        sub: info.sub,
        life: 0.16,
        maxLife: 0.16
      });
      const sfx = info.sub === "laser" ? "laser" : (info.sub === "bow" ? "arrow_thwip" : "gunshot");
      G.playSfx(sfx, 0.95 + Math.random() * 0.1, 0.5);
    } else if (info.type === "magic") {
      G.weaponEffects.push({
        kind: info.sub === "lightning" ? "lightning" : "bolt",
        x1: sx,
        y1: sy,
        x2: ex,
        y2: ey,
        color: info.color,
        sub: info.sub,
        life: 0.22,
        maxLife: 0.22
      });
      const sfx = info.sub === "fire" ? "fireball" : (info.sub === "ice" ? "freeze" : (info.sub === "lightning" ? "lightning" : "magic"));
      G.playSfx(sfx, 1.0 + Math.random() * 0.1, 0.5);
      for (let i = 0; i < 5; i++) {
        G.particles.push({
          x: ex + (Math.random() - 0.5) * 12,
          y: ey + (Math.random() - 0.5) * 12,
          vx: (Math.random() - 0.5) * 3,
          vy: (Math.random() - 0.5) * 3 - 0.6,
          color: info.color,
          size: 3.2,
          life: 0.3,
          maxLife: 0.3
        });
      }
    } else if (info.type === "rayman") {
      G.weaponEffects.push({
        kind: "ring",
        x: ex,
        y: ey,
        color: "#38bdf8",
        maxRadius: 24,
        life: 0.22,
        maxLife: 0.22
      });
      G.playSfx("ionic_pulse", 1.15, 0.4);
    } else if (info.type === "tool") {
      G.weaponEffects.push({
        kind: "spark",
        x: ex,
        y: ey,
        color: "#fde047",
        life: 0.16,
        maxLife: 0.16
      });
    }
  }

  G.triggerPunchAnim = function triggerPunchAnim(tileX, tileY, { isBlockBreak = true } = {}) {
    player.punchTimer = player.punchMaxTimer;
    player.punchTargetX = tileX * TILE + TILE / 2;
    player.punchTargetY = tileY * TILE + TILE / 2;
    const cx = player.x + player.width / 2;
    if (player.punchTargetX > cx + 2) player.facing = 1;
    else if (player.punchTargetX < cx - 2) player.facing = -1;

    if (isBlockBreak) {
      spawnWeaponAttackVfx(tileX, tileY);
    }
  };

  /* ─── Physics Update Loop ─── */
  G.updatePlayer = function updatePlayer(dt) {
    const w = G.world;
    if (!w) return;

    if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) {
      G.respawnPlayer();
    }

    const safeDt = Math.max(0, Math.min(0.05, Number(dt) || 0.016));
    const ts = Math.min(2.0, safeDt * 60);

    // Update Weapon Effects lifetime
    for (let i = G.weaponEffects.length - 1; i >= 0; i--) {
      G.weaponEffects[i].life -= safeDt;
      if (G.weaponEffects[i].life <= 0) G.weaponEffects.splice(i, 1);
    }

    player.animTimer += safeDt;
    if (player.invincibleTimer > 0) player.invincibleTimer = Math.max(0, player.invincibleTimer - safeDt);
    if (player.punchTimer > 0) player.punchTimer = Math.max(0, player.punchTimer - safeDt);
    if (player.punchCooldown > 0) player.punchCooldown = Math.max(0, player.punchCooldown - safeDt);
    if (player.chatTimer > 0) player.chatTimer = Math.max(0, player.chatTimer - safeDt);
    if (player.glideSoundTimer > 0) player.glideSoundTimer = Math.max(0, player.glideSoundTimer - safeDt);
    if (player.backFxTimer > 0) player.backFxTimer = Math.max(0, player.backFxTimer - safeDt);

    if (player.isDead) {
      player.deathTimer -= safeDt;
      player.x += player.vx * ts;
      player.y += player.vy * ts;
      player.vy += 0.45 * ts;
      if (player.deathTimer <= 0) G.respawnPlayer();
      G.updateCamera();
      return;
    }

    const cx = Math.floor((player.x + player.width / 2) / TILE);
    const cy = Math.floor((player.y + player.height / 2) / TILE);
    const centerIdx = cy >= 0 && cy < w.height && cx >= 0 && cx < w.width ? cy * w.width + cx : -1;
    const onClimbable = centerIdx !== -1 && (G.isClimbableTile(G.getItem(w.fg[centerIdx])) || G.isClimbableTile(G.getItem(w.bg[centerIdx])));

    if (onClimbable && (player.keys.up || player.keys.jump || player.keys.down)) {
      player.isClimbing = true;
      player.isGrounded = false;
      player.jumpCount = 0;
      player.vy = (player.keys.up || player.keys.jump) ? -3.4 : 3.4;
    } else if (!onClimbable) {
      player.isClimbing = false;
    } else if (player.isClimbing) {
      player.vy = 0;
    }

    const speedBoost = G.hasSpeedGear() ? 1.32 : 1.0;
    const moveAccel = 1.35 * speedBoost;
    const maxSpeed = 4.6 * speedBoost;
    if (player.keys.left) {
      player.vx -= moveAccel * ts;
      player.facing = -1;
    } else if (player.keys.right) {
      player.vx += moveAccel * ts;
      player.facing = 1;
    } else {
      player.vx *= Math.pow(0.72, ts);
      if (Math.abs(player.vx) < 0.08) player.vx = 0;
    }
    player.vx = Math.max(-maxSpeed, Math.min(maxSpeed, player.vx));

    if (player.isGrounded && Math.abs(player.vx) > 0.3) {
      player.walkPhase += safeDt * (15 * speedBoost);
    }

    const hasBack = G.hasWings();
    const backStyle = G.getBackAnimStyle();
    const maxJumps = hasBack ? 2 : 1;
    const jumpPower = G.hasHighJumpGear() ? -10.5 : -9.6;
    const wantsJump = player.keys.jump || (player.keys.up && !onClimbable);

    if (wantsJump && !player.jumpConsumed) {
      if (player.isGrounded || player.isClimbing) {
        player.isClimbing = false;
        player.vy = jumpPower;
        player.isGrounded = false;
        player.jumpCount = 1;
        player.jumpConsumed = true;
        G.playSfx("jump", 1.0, 0.55);
      } else if (player.jumpCount < maxJumps) {
        player.vy = -8.4;
        player.jumpCount++;
        player.jumpConsumed = true;
        G.playSfx(backStyle === "jetpack" ? "startopia_jump_thruster" : "wing_flap", 1.1, 0.65);
      }
    }
    if (!wantsJump) {
      player.jumpConsumed = false;
    }

    if (!player.isClimbing) {
      player.vy += 0.52 * ts;
      if (hasBack && wantsJump && player.vy > 1.8 && !player.isGrounded) {
        player.vy = 1.8;
        if (player.glideSoundTimer <= 0) {
          G.playSfx(backStyle === "jetpack" ? "startopia_jump_thruster_hover" : "wing_flap", 0.95, 0.35);
          player.glideSoundTimer = 0.28;
        }
      } else if (player.vy > 11.0) {
        player.vy = 11.0;
      }
    }

    if (hasBack && !player.isGrounded && player.backFxTimer <= 0) {
      const px = player.x + player.width / 2 - player.facing * 6;
      const py = player.y + player.height * 0.65;
      if (backStyle === "jetpack" && (wantsJump || player.vy < 0)) {
        player.backFxTimer = 0.05;
        G.particles.push({
          x: px + (Math.random() - 0.5) * 6,
          y: py,
          vx: -player.facing * 0.6 + (Math.random() - 0.5) * 0.8,
          vy: 1.8 + Math.random() * 1.4,
          color: Math.random() < 0.55 ? "#f97316" : "#fde047",
          size: 3.5,
          life: 0.26,
          maxLife: 0.26
        });
      } else if (backStyle === "fairy") {
        player.backFxTimer = 0.09;
        const cols = ["#f472b6", "#38bdf8", "#fde047", "#c084fc"];
        G.particles.push({
          x: px + (Math.random() - 0.5) * 14,
          y: py + (Math.random() - 0.5) * 10,
          vx: (Math.random() - 0.5) * 0.8,
          vy: 0.3 + Math.random() * 0.6,
          color: cols[Math.floor(Math.random() * cols.length)],
          size: 2.5,
          life: 0.38,
          maxLife: 0.38
        });
      }
    }

    player.x += player.vx * ts;
    resolveX(w);

    player.y += player.vy * ts;
    player.isGrounded = false;
    resolveY(w);

    const maxW = w.width * TILE;
    const maxH = w.height * TILE;
    if (player.x < 0) { player.x = 0; player.vx = 0; }
    if (player.x + player.width > maxW) { player.x = maxW - player.width; player.vx = 0; }
    if (player.y < 0) { player.y = 0; player.vy = 0; }
    if (player.y > maxH + 64) G.respawnPlayer();

    G.updateCamera();
  };

  function resolveX(w) {
    const minX = Math.floor(player.x / TILE);
    const maxX = Math.floor((player.x + player.width) / TILE);
    const minY = Math.floor((player.y + 2) / TILE);
    const maxY = Math.floor((player.y + player.height - 2) / TILE);

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (tx < 0 || tx >= w.width || ty < 0 || ty >= w.height) continue;
        const item = G.getItem(w.fg[ty * w.width + tx]);
        if (!item) continue;
        if (G.isHazardTile(item)) {
          G.killPlayer(`Ouch! Touched ${item.name}.`);
          return;
        }
        if (G.isSolidTile(item)) {
          if (player.vx > 0) {
            player.x = tx * TILE - player.width - 0.01;
            player.vx = 0;
          } else if (player.vx < 0) {
            player.x = (tx + 1) * TILE + 0.01;
            player.vx = 0;
          }
        }
      }
    }
  }

  function resolveY(w) {
    const minX = Math.floor((player.x + 2) / TILE);
    const maxX = Math.floor((player.x + player.width - 2) / TILE);
    const minY = Math.floor(player.y / TILE);
    const maxY = Math.floor((player.y + player.height) / TILE);

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (tx < 0 || tx >= w.width || ty < 0 || ty >= w.height) continue;
        const item = G.getItem(w.fg[ty * w.width + tx]);
        if (!item) continue;
        if (G.isHazardTile(item)) {
          G.killPlayer(`Ouch! Touched ${item.name}.`);
          return;
        }

        const solid = G.isSolidTile(item);
        const plat = G.isPlatformTile(item);

        if ((solid || plat) && player.vy > 0 && G.isBouncyTile(item)) {
          player.y = ty * TILE - player.height;
          player.vy = -12.5;
          player.isGrounded = false;
          player.jumpCount = 1;
          G.playSfx("trampoline", 1.0, 0.75);
          return;
        }

        if (solid) {
          if (player.vy > 0) {
            player.y = ty * TILE - player.height;
            player.vy = 0;
            player.isGrounded = true;
            player.jumpCount = 0;
          } else if (player.vy < 0) {
            player.y = (ty + 1) * TILE;
            player.vy = 0;
          }
        } else if (plat && !player.keys.down) {
          const top = ty * TILE;
          if (player.vy >= 0 && player.y + player.height <= top + 10) {
            player.y = top - player.height;
            player.vy = 0;
            player.isGrounded = true;
            player.jumpCount = 0;
          }
        }
      }
    }
  }

  G.updateCamera = function updateCamera() {
    if (!G.canvas || !G.world) return;
    const dpr = root.devicePixelRatio || 1;
    const viewW = G.canvas.width / dpr;
    const viewH = G.canvas.height / dpr;
    const vp = G.viewport;

    if (!Number.isFinite(vp.x) || !Number.isFinite(vp.y)) {
      vp.x = 0;
      vp.y = 0;
    }

    const targetX = viewW / 2 - (player.x + player.width / 2) * vp.zoom;
    const targetY = viewH / 2 - (player.y + player.height / 2) * vp.zoom;

    vp.x += (targetX - vp.x) * 0.22;
    vp.y += (targetY - vp.y) * 0.22;

    const worldW = G.world.width * TILE * vp.zoom;
    const worldH = G.world.height * TILE * vp.zoom;
    if (worldW > viewW) {
      vp.x = Math.min(0, Math.max(viewW - worldW, vp.x));
    } else {
      vp.x = (viewW - worldW) / 2;
    }
    if (worldH > viewH) {
      vp.y = Math.min(0, Math.max(viewH - worldH, vp.y));
    } else {
      vp.y = (viewH - worldH) / 2;
    }
  };

  /* ─── Resolve Animated Wearable Frames ─── */
  function getWearableDrawFrames(item, nowMs, isAirborneWing) {
    const seq = root.GTWearableSequence;
    const rawDesc = G.wearableAnimMap && G.wearableAnimMap[String(item.id)];
    if (!seq || !rawDesc) return [{ dx: 0, dy: 0 }];

    try {
      const desc = seq.normalizeDescriptor(rawDesc);
      const count = seq.getFrameCount(desc);
      const interval = isAirborneWing ? 85 : 170;
      const frameIdx = Math.floor((nowMs || 0) / interval) % count;
      return seq.resolveDrawPlan(desc, { mode: "paused", frame: frameIdx, intervalMs: interval }, 0);
    } catch (_) {
      return [{ dx: 0, dy: 0 }];
    }
  }

  /* ─── Specialized Back / Wing Renderer ─── */
  function drawBackWearable(ctx, item, img, ox, oy, bobY, nowMs) {
    const style = G.getBackAnimStyle();
    const isAirborne = !player.isGrounded;
    const frames = getWearableDrawFrames(item, nowMs, isAirborne);

    ctx.save();
    ctx.translate(ox, oy + bobY);

    if (style === "jetpack") {
      const tilt = isAirborne ? 0.12 : 0;
      const vibY = isAirborne ? Math.sin(player.animTimer * 45) * 0.6 : 0;
      ctx.translate(0, vibY);
      ctx.rotate(tilt);
      for (let f = 0; f < frames.length; f++) {
        const sx = ((item.tx || 0) + (frames[f].dx || 0)) * 32;
        const sy = ((item.ty || 0) + (frames[f].dy || 0)) * 32;
        if (sx >= 0 && sy >= 0 && sx + 32 <= img.naturalWidth && sy + 32 <= img.naturalHeight) {
          ctx.drawImage(img, sx, sy, 32, 32, -16, -16, 32, 32);
        }
      }
      ctx.restore();
      return;
    }

    if (style === "cape") {
      const speedRatio = Math.min(1, Math.abs(player.vx) / 4.5);
      const billow = isAirborne
        ? (0.22 + Math.sin(player.animTimer * 12) * 0.08)
        : (speedRatio * 0.2 + Math.sin(player.animTimer * 7) * 0.04 * speedRatio);
      ctx.translate(0, -6);
      ctx.rotate(billow);
      ctx.scale(1 + billow * 0.35, 1);
      ctx.translate(0, 6);
      for (let f = 0; f < frames.length; f++) {
        const sx = ((item.tx || 0) + (frames[f].dx || 0)) * 32;
        const sy = ((item.ty || 0) + (frames[f].dy || 0)) * 32;
        if (sx >= 0 && sy >= 0 && sx + 32 <= img.naturalWidth && sy + 32 <= img.naturalHeight) {
          ctx.drawImage(img, sx, sy, 32, 32, -16, -16, 32, 32);
        }
      }
      ctx.restore();
      return;
    }

    const freq = style === "fairy" ? 36 : (style === "heavy_wings" ? 15 : 22);
    const ampAngle = isAirborne
      ? (style === "fairy" ? 0.34 : (style === "heavy_wings" ? 0.42 : 0.36))
      : (style === "fairy" ? 0.14 : 0.05);
    const flapVal = Math.sin(player.animTimer * freq);
    const wingAngle = flapVal * ampAngle;
    const wingScaleX = isAirborne ? (1.06 + flapVal * 0.14) : (1.0 + flapVal * 0.03);

    for (let f = 0; f < frames.length; f++) {
      const sx = ((item.tx || 0) + (frames[f].dx || 0)) * 32;
      const sy = ((item.ty || 0) + (frames[f].dy || 0)) * 32;
      if (sx < 0 || sy < 0 || sx + 32 > img.naturalWidth || sy + 32 > img.naturalHeight) continue;

      ctx.save();
      ctx.rotate(-wingAngle);
      ctx.scale(wingScaleX, 1);
      ctx.drawImage(img, sx, sy, 16, 32, -16, -16, 16, 32);
      ctx.restore();

      ctx.save();
      ctx.rotate(wingAngle);
      ctx.scale(wingScaleX, 1);
      ctx.drawImage(img, sx + 16, sy, 16, 32, 0, -16, 16, 32);
      ctx.restore();
    }

    ctx.restore();
  }

  /* ─── Official GTWearableCatalog + AvatarPositioning Layer Renderer ─── */
  function drawEquippedPhase(ctx, phase, bobY, nowMs, { skipHand = false } = {}) {
    const catalog = root.GTWearableCatalog;
    if (!catalog) return;
    const layers = catalog.getRenderLayers();

    for (let i = 0; i < layers.length; i++) {
      const slotDef = layers[i];
      if (slotDef.phase !== phase) continue;
      if (skipHand && slotDef.key === "Hand") continue;

      const item = player.equipped[slotDef.key];
      if (!item || !item.texture) continue;

      const img = G.getTilesheet(item.texture);
      if (!isReady(img)) continue;

      const defOff = slotDef.defaultOffset || { x: 0, y: 0 };
      const userOff = G.getItemCustomOffset(slotDef.key, item.id);
      const baseHandShift = slotDef.key === "Hand" ? { x: 7, y: 5 } : { x: 0, y: 0 };
      const ox = defOff.x + baseHandShift.x + userOff.x;
      const oy = defOff.y + baseHandShift.y + userOff.y;

      if (slotDef.key === "Back") {
        drawBackWearable(ctx, item, img, ox, oy, bobY, nowMs);
        continue;
      }

      const frames = getWearableDrawFrames(item, nowMs, false);
      ctx.save();
      ctx.translate(ox, oy + bobY);

      for (let f = 0; f < frames.length; f++) {
        const sx = ((item.tx || 0) + (frames[f].dx || 0)) * 32;
        const sy = ((item.ty || 0) + (frames[f].dy || 0)) * 32;
        if (sx >= 0 && sy >= 0 && sx + 32 <= img.naturalWidth && sy + 32 <= img.naturalHeight) {
          ctx.drawImage(img, sx, sy, 32, 32, -16, -16, 32, 32);
        }
      }
      ctx.restore();
    }
  }

  /* ─── Animated Active Hand Weapon Swing / Shot (Replaces Bare Fist When Equipped) ─── */
  function drawActiveHandAttack(ctx, info, bobY, nowMs, punchProg, punchExt, showWorldPunch) {
    const item = info.item;
    if (!item || !item.texture) return;
    const img = G.getTilesheet(item.texture);
    if (!isReady(img)) return;

    const userOff = G.getItemCustomOffset("Hand", item.id);
    const ox = 7 + userOff.x;
    const oy = 5 + userOff.y;
    const frames = getWearableDrawFrames(item, nowMs, false);

    const cx = player.x + player.width / 2;
    const cy = player.y + player.height / 2;
    const dx = (player.punchTargetX - cx) * player.facing;
    const dy = player.punchTargetY - cy;
    const aimAngle = Math.atan2(dy, dx);

    // 1. Rayman's Fist / Boxing Glove / Fist -> Itemnya sendiri melesat ke target!
    if ((info.type === "rayman" || info.type === "fist") && showWorldPunch) {
      const maxReach = info.type === "rayman" ? 105 : 74;
      const dist = Math.min(maxReach, Math.hypot(dx, dy)) * punchExt;

      ctx.save();
      ctx.translate(4, 5 + bobY);
      ctx.rotate(aimAngle);

      // Trail energi biru untuk Rayman, atau garis gerak untuk boxing glove
      ctx.fillStyle = info.type === "rayman" ? "rgba(56, 189, 248, 0.55)" : "rgba(255, 255, 255, 0.35)";
      ctx.fillRect(0, -2, Math.max(2, dist - 8), 4);

      for (let f = 0; f < frames.length; f++) {
        const sx = ((item.tx || 0) + (frames[f].dx || 0)) * 32;
        const sy = ((item.ty || 0) + (frames[f].dy || 0)) * 32;
        if (sx >= 0 && sy >= 0 && sx + 32 <= img.naturalWidth && sy + 32 <= img.naturalHeight) {
          ctx.drawImage(img, sx, sy, 32, 32, dist - 16, -16, 32, 32);
        }
      }
      ctx.restore();
      return;
    }

    // 2. Pickaxe / Axe / Hammer / Blade / Ranged / Magic / Generic -> Ayun / Tembak item aslinya!
    ctx.save();
    let swingAngle = 0;
    let pushX = 0;
    let pushY = 0;

    if (info.type === "tool") {
      // Gerakan nyangkul: angkat ke belakang (-1.25 rad) -> hantam ke bawah (+1.05 rad)
      swingAngle = punchProg < 0.3
        ? -1.25 * (punchProg / 0.3)
        : -1.25 + 2.3 * ((punchProg - 0.3) / 0.7);
      pushX = punchExt * 5;
      pushY = punchExt * 2;
    } else if (info.type === "blade") {
      // Gerakan tebas melengkung cepat
      swingAngle = -1.4 + punchProg * 2.55;
      pushX = punchExt * 7;
      pushY = -punchExt * 1.5;
    } else if (info.type === "ranged") {
      // Bidik ke arah target + hentakan recoil ke belakang
      const clampedAim = Math.max(-0.9, Math.min(0.9, aimAngle));
      swingAngle = clampedAim - punchExt * 0.14;
      pushX = -punchExt * 4;
    } else if (info.type === "magic") {
      // Angkat tongkat sihir + sorot ujung
      swingAngle = -0.75 * punchExt;
      pushX = punchExt * 4;
      pushY = -punchExt * 3;
    } else {
      // Generic hand item jab
      swingAngle = -0.6 * punchExt;
      pushX = punchExt * 6;
    }

    ctx.translate(ox + pushX, oy + bobY + pushY);
    ctx.rotate(swingAngle);

    for (let f = 0; f < frames.length; f++) {
      const sx = ((item.tx || 0) + (frames[f].dx || 0)) * 32;
      const sy = ((item.ty || 0) + (frames[f].dy || 0)) * 32;
      if (sx >= 0 && sy >= 0 && sx + 32 <= img.naturalWidth && sy + 32 <= img.naturalHeight) {
        ctx.drawImage(img, sx, sy, 32, 32, -16, -16, 32, 32);
      }
    }

    // Muzzle flash / kilau ujung tongkat saat menembak
    if (info.type === "ranged" && punchProg < 0.45 && info.sub !== "bow") {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(13, -1, 4.5 * (1 - punchProg / 0.45), 0, Math.PI * 2);
      ctx.fill();
    } else if (info.type === "magic" && punchProg < 0.65) {
      ctx.fillStyle = info.color;
      ctx.globalAlpha = 0.85 * (1 - punchProg / 0.65);
      ctx.beginPath();
      ctx.arc(8, -10, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /* ─── Render World-Space Weapon Effects (Slash Arc, Laser, Magic Bolt, Sparks) ─── */
  function drawWeaponEffects(ctx) {
    for (let i = 0; i < G.weaponEffects.length; i++) {
      const fx = G.weaponEffects[i];
      const prog = 1 - Math.max(0, fx.life / fx.maxLife);
      const alpha = Math.max(0, 1 - prog);

      ctx.save();
      ctx.globalAlpha = alpha;

      if (fx.kind === "slash") {
        ctx.translate(fx.x, fx.y);
        ctx.rotate(fx.angle);
        const startA = -1.15 + prog * 0.6;
        const endA = 0.95 + prog * 0.4;
        // Outer colored slash glow
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = Math.max(1.5, 5.5 * (1 - prog * 0.6));
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(-6, 0, fx.radius, startA, endA);
        ctx.stroke();
        // Crisp white inner edge
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(1, 2.2 * (1 - prog * 0.6));
        ctx.beginPath();
        ctx.arc(-6, 0, fx.radius - 1, startA + 0.15, endA - 0.1);
        ctx.stroke();
      } else if (fx.kind === "beam") {
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = Math.max(1.5, 5 * (1 - prog));
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(fx.x1, fx.y1);
        ctx.lineTo(fx.x2, fx.y2);
        ctx.stroke();

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(1, 2 * (1 - prog));
        ctx.beginPath();
        ctx.moveTo(fx.x1, fx.y1);
        ctx.lineTo(fx.x2, fx.y2);
        ctx.stroke();

        // Impact flash
        ctx.fillStyle = fx.color;
        ctx.beginPath();
        ctx.arc(fx.x2, fx.y2, 4 + prog * 8, 0, Math.PI * 2);
        ctx.fill();
      } else if (fx.kind === "lightning") {
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = 3.5 * (1 - prog * 0.5);
        ctx.beginPath();
        ctx.moveTo(fx.x1, fx.y1);
        const steps = 5;
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const mx = fx.x1 + (fx.x2 - fx.x1) * t + (Math.random() - 0.5) * 10;
          const my = fx.y1 + (fx.y2 - fx.y1) * t + (Math.random() - 0.5) * 10;
          ctx.lineTo(mx, my);
        }
        ctx.lineTo(fx.x2, fx.y2);
        ctx.stroke();

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.4;
        ctx.stroke();
      } else if (fx.kind === "bolt") {
        const bx = fx.x1 + (fx.x2 - fx.x1) * Math.min(1, prog * 1.4);
        const by = fx.y1 + (fx.y2 - fx.y1) * Math.min(1, prog * 1.4);
        if (fx.sub === "bow") {
          const a = Math.atan2(fx.y2 - fx.y1, fx.x2 - fx.x1);
          ctx.translate(bx, by);
          ctx.rotate(a);
          ctx.strokeStyle = "#fde047";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-8, 0);
          ctx.lineTo(6, 0);
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(4, -1.5, 3, 3);
        } else {
          ctx.fillStyle = fx.color;
          ctx.beginPath();
          ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (fx.kind === "ring") {
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = Math.max(1, 3 * (1 - prog));
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, 4 + prog * fx.maxRadius, 0, Math.PI * 2);
        ctx.stroke();
      } else if (fx.kind === "spark") {
        const r = 4 + prog * 11;
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx.x - r, fx.y - r); ctx.lineTo(fx.x + r, fx.y + r);
        ctx.moveTo(fx.x + r, fx.y - r); ctx.lineTo(fx.x - r, fx.y + r);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  /* ─── Single Shared Character Renderer (1:1 app.js Base Set GT) ─── */
  function renderCharacterSprite(ctx, nowMs, { showWorldPunch = true } = {}) {
    const skin = player.skinColor || "#ffc3aa";
    const isWalking = player.isGrounded && Math.abs(player.vx) > 0.3;
    const bobY = isWalking ? Math.abs(Math.sin(player.walkPhase)) * -1.4 : Math.sin(player.animTimer * 3.5) * 0.35;
    const legSwing = isWalking ? Math.sin(player.walkPhase) * 0.45 : (!player.isGrounded ? 0.25 : 0);

    const armR = getTintedPart(BASE_SET.tanganKanan, skin);
    const legL = getTintedPart(BASE_SET.kakiKiri, skin);
    const legR = getTintedPart(BASE_SET.kakiKanan, skin);
    const body = getTintedPart(player.equipped.Shirt ? BASE_SET.bodyNaked : BASE_SET.body, skin);
    const sclera = G.loadImage(BASE_SET.bolaMata);
    const pupil = G.loadImage(BASE_SET.pupil);
    const head = getTintedPart(BASE_SET.headBolong, skin);
    const mulut = getTintedPart(BASE_SET.mulut, skin);
    const tutupMata = getTintedPart(BASE_SET.tutupMata, skin);
    const armL = getTintedPart(BASE_SET.tanganKiri, skin);

    // 1. Back / Wings / Artifact
    drawEquippedPhase(ctx, "behind-base", bobY, nowMs);

    // 2. Base Player Skin
    if (armR) {
      ctx.save();
      ctx.translate(0, bobY);
      ctx.rotate(-legSwing * 0.5);
      ctx.drawImage(armR, -16, -16, 32, 32);
      ctx.restore();
    }
    if (legL) {
      ctx.save();
      ctx.translate(0, 6);
      ctx.rotate(-legSwing * 0.55);
      ctx.drawImage(legL, -16, -22, 32, 32);
      ctx.restore();
    }
    if (legR) {
      ctx.save();
      ctx.translate(0, 6);
      ctx.rotate(legSwing * 0.55);
      ctx.drawImage(legR, -16, -22, 32, 32);
      ctx.restore();
    }
    if (body) {
      ctx.drawImage(body, -16, -16 + bobY, 32, 32);
    } else {
      ctx.fillStyle = skin;
      ctx.fillRect(-6, -2 + bobY, 12, 10);
    }
    if (isReady(sclera)) ctx.drawImage(sclera, -16, -16 + bobY, 32, 32);
    if (isReady(pupil)) ctx.drawImage(pupil, -16, -16 + bobY, 32, 32);
    if (head) {
      ctx.drawImage(head, -16, -16 + bobY, 32, 32);
    } else {
      ctx.fillStyle = skin;
      ctx.fillRect(-7, -14 + bobY, 14, 12);
    }
    if (mulut) ctx.drawImage(mulut, -16, -16 + bobY, 32, 32);
    if (tutupMata) ctx.drawImage(tutupMata, -16, -16 + bobY, 32, 32);

    const isPunching = player.punchTimer > 0;
    const punchProg = isPunching ? (1 - player.punchTimer / player.punchMaxTimer) : 0;
    const punchExt = isPunching ? Math.sin(punchProg * Math.PI) : 0;
    const handInfo = G.getHandWeaponInfo();

    // 3. Front Wearables (Skip Hand saat sedang menyerang agar item tangan tidak dobel)
    drawEquippedPhase(ctx, "wearable", bobY, nowMs, {
      skipHand: isPunching && handInfo.type !== "none"
    });

    // 4. Front Arm & Attack Animation (NO bare fist if holding ANY Hand weapon!)
    if (isPunching) {
      if (handInfo.type !== "none") {
        // Lengan ikut mengayun natural, lalu gambar senjata yang sedang beraksi
        if (armL) {
          ctx.save();
          ctx.translate(punchExt * 3, bobY);
          ctx.rotate(-punchExt * 0.5);
          ctx.drawImage(armL, -16, -16, 32, 32);
          ctx.restore();
        }
        drawActiveHandAttack(ctx, handInfo, bobY, nowMs, punchProg, punchExt, showWorldPunch);
      } else if (showWorldPunch) {
        // Slot Hand kosong -> Tangan polos melar ala Real GT
        const cx = player.x + player.width / 2;
        const cy = player.y + player.height / 2;
        const dx = (player.punchTargetX - cx) * player.facing;
        const dy = player.punchTargetY - cy;
        const angle = Math.atan2(dy, dx);
        const dist = Math.min(72, Math.hypot(dx, dy)) * punchExt;

        ctx.save();
        ctx.translate(4, 5 + bobY);
        ctx.rotate(angle);
        ctx.fillStyle = skin;
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1;
        ctx.fillRect(0, -3, Math.max(4, dist - 8), 6);
        ctx.strokeRect(0, -3, Math.max(4, dist - 8), 6);

        const fistImg = G.loadImage(BASE_SET.fist);
        if (isReady(fistImg)) {
          ctx.drawImage(fistImg, dist - 12, -11, 22, 22);
        } else {
          ctx.fillStyle = skin;
          ctx.fillRect(dist - 8, -7, 14, 14);
          ctx.strokeRect(dist - 8, -7, 14, 14);
        }
        ctx.restore();
      } else if (armL) {
        ctx.save();
        ctx.translate(punchExt * 5, bobY - punchExt * 2);
        ctx.rotate(-punchExt * 0.55);
        ctx.drawImage(armL, -16, -16, 32, 32);
        ctx.restore();
      }
    } else if (armL) {
      ctx.save();
      ctx.translate(0, bobY);
      ctx.rotate(legSwing * 0.5);
      ctx.drawImage(armL, -16, -16, 32, 32);
      ctx.restore();
    }
  }

  /* ─── Real-Time Live Top-Left Portrait ─── */
  G.renderMiniAvatar = function renderMiniAvatar(nowMs = performance.now()) {
    const mini = document.getElementById("hud-avatar-mini");
    if (!mini) return;
    if (mini.width !== 48 || mini.height !== 48) {
      mini.width = 48;
      mini.height = 48;
    }
    const ctx = mini.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 48, 48);

    ctx.save();
    ctx.translate(24, 32);
    if (player.isDead) ctx.rotate((0.75 - player.deathTimer) * 14);
    if (player.facing < 0) ctx.scale(-1, 1);
    ctx.scale(0.95, 0.95);

    renderCharacterSprite(ctx, nowMs, { showWorldPunch: false });
    ctx.restore();
  };

  /* ─── Draw Character + World Weapon VFX ─── */
  G.drawPlayer = function drawPlayer(ctx, nowMs) {
    const cx = Math.round(player.x + player.width / 2);
    const cy = Math.round(player.y + player.height / 2 - 2);

    ctx.save();
    ctx.translate(cx, cy);
    if (player.invincibleTimer > 0 && Math.floor(player.animTimer * 16) % 2 === 0) {
      ctx.globalAlpha = 0.55;
    }
    if (player.isDead) {
      ctx.rotate((0.75 - player.deathTimer) * 14);
    }
    if (player.facing < 0) ctx.scale(-1, 1);

    renderCharacterSprite(ctx, nowMs, { showWorldPunch: true });
    ctx.restore();

    // Render efek tebasan, laser, sihir, & percikan di koordinat world
    drawWeaponEffects(ctx);

    if (!player.isDead) {
      ctx.save();
      ctx.font = "bold 9px 'Trebuchet MS', Arial";
      ctx.textAlign = "center";
      ctx.fillStyle = "#000000";
      ctx.fillText(player.name, cx + 1, player.y - 16);
      ctx.fillText(player.name, cx - 1, player.y - 16);
      ctx.fillText(player.name, cx, player.y - 15);
      ctx.fillText(player.name, cx, player.y - 17);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(player.name, cx, player.y - 16);

      if (player.chatText && player.chatTimer > 0) {
        ctx.font = "bold 9px 'Trebuchet MS', Arial";
        const tw = Math.min(185, Math.max(36, ctx.measureText(player.chatText).width + 14));
        const bx = cx - tw / 2;
        const by = player.y - 43;
        const bh = 16;

        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.strokeStyle = "#102a43";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(bx, by, tw, bh, 4);
        } else {
          ctx.rect(bx, by, tw, bh);
        }
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(cx - 3.5, by + bh);
        ctx.lineTo(cx, by + bh + 4);
        ctx.lineTo(cx + 3.5, by + bh);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#0f172a";
        ctx.fillText(player.chatText, cx, by + 11);
      }
      ctx.restore();
    }
  };
})(window); 