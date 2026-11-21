(function initGTGameplay(root) {
  const G = root.GTGame;
  if (!G) return;

  const TILE = G.TILE_SIZE;
  const MAX_STACK = 200;
  const MAX_SLOTS = 36;
  const SHOP_PAGE_SIZE = 48;
  const DRAWER_STATES = ["collapsed", "normal", "expanded"];

  let saveWorldDebounce = null;
  let activeShopTab = "special";
  let shopVisibleLimit = SHOP_PAGE_SIZE;
  let pendingDropSlotIdx = -1;
  let posBarOpen = false;
  let isPointerDownOnCanvas = false;
  let pointerTile = { x: -1, y: -1 };
  let lastLoggedErr = "";

  /* ─── HUD Scale, Camera Zoom & Fullscreen Helpers ─── */
  function applyHudScale(pct) {
    const clamped = Math.max(70, Math.min(130, parseInt(pct, 10) || 100));
    document.documentElement.style.setProperty("--hud-scale", String(clamped / 100));
    const slider = document.getElementById("hud-scale-slider");
    const valEl = document.getElementById("hud-scale-val");
    if (slider) slider.value = String(clamped);
    if (valEl) valEl.textContent = `${clamped}%`;
    try { localStorage.setItem("gt_surv_hud_scale", String(clamped)); } catch (_) {}
  }

  function applyZoom(newZoom) {
    const clamped = Math.max(1.0, Math.min(3.25, Math.round(newZoom * 100) / 100));
    G.viewport.zoom = clamped;
    try { localStorage.setItem("gt_surv_zoom", String(clamped)); } catch (_) {}
  }

  function isFullscreenActive() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function updateFullscreenUI() {
    const active = isFullscreenActive();
    const btn = document.getElementById("btn-fullscreen");
    if (btn) btn.classList.toggle("active", active);
    const menuBtn = document.getElementById("btn-menu-fullscreen");
    if (menuBtn) menuBtn.textContent = active ? "EXIT FULLSCREEN" : "ENTER FULLSCREEN";
  }

  async function toggleFullscreen() {
    try {
      if (!isFullscreenActive()) {
        const el = document.documentElement;
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        }
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock("landscape").catch(() => {});
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    } catch (_) {
      G.addChatLine("Fullscreen not supported by this browser.", true);
    }
    setTimeout(() => {
      updateFullscreenUI();
      resizeCanvas();
    }, 120);
  }

  /* ─── Real GT Top-Center Chat Log ─── */
  G.addChatLine = function addChatLine(text, isSys = false, sender = "") {
    const log = document.getElementById("chat-log");
    if (!log) return;

    const div = document.createElement("div");
    div.className = `chat-line${isSys ? " sys" : ""}`;

    if (sender) {
      const s = document.createElement("span");
      s.className = "chat-sender";
      s.textContent = `${sender}: `;
      div.appendChild(s);
      div.appendChild(document.createTextNode(text));
    } else {
      div.textContent = text;
    }

    log.appendChild(div);
    while (log.children.length > 30) {
      log.removeChild(log.firstChild);
    }
    log.scrollTop = log.scrollHeight;
  };

  function spawnFloatingText(x, y, text, color = "#ffe666") {
    G.floatingTexts.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
  }

  function spawnBreakParticles(tx, ty, color = "#a16207", count = 6) {
    const cx = tx * TILE + TILE / 2;
    const cy = ty * TILE + TILE / 2;
    for (let i = 0; i < count; i++) {
      G.particles.push({
        x: cx + (Math.random() - 0.5) * 14,
        y: cy + (Math.random() - 0.5) * 14,
        vx: (Math.random() - 0.5) * 3.6,
        vy: -1.5 - Math.random() * 2.5,
        color,
        size: 3 + Math.random() * 2.5,
        life: 0.4 + Math.random() * 0.25,
        maxLife: 0.65
      });
    }
  }

  function scheduleWorldSave() {
    if (saveWorldDebounce) clearTimeout(saveWorldDebounce);
    saveWorldDebounce = setTimeout(() => G.saveWorld(), 1000);
  }

  /* ─── Inventory System + Live Wearable POS Adjuster ─── */
  G.updateGemsHUD = function updateGemsHUD() {
    const txt = G.gems.toLocaleString();
    const el = document.getElementById("hud-gems-val");
    if (el) el.textContent = txt;
    const storeEl = document.getElementById("store-gems-val");
    if (storeEl) storeEl.textContent = txt;
  };

  G.addToInventory = function addToInventory(itemId, qty = 1) {
    const id = Number(itemId);
    const add = Math.max(1, Math.floor(qty));
    const existing = G.inventory.find((s) => Number(s.id) === id);
    if (existing) {
      existing.qty = Math.min(MAX_STACK, existing.qty + add);
    } else {
      G.inventory.push({ id, qty: Math.min(MAX_STACK, add) });
    }
    G.renderInventory();
    G.savePlayerData();
  };

  G.removeFromInventory = function removeFromInventory(itemId, qty = 1) {
    const id = Number(itemId);
    const idx = G.inventory.findIndex((s) => Number(s.id) === id);
    if (idx === -1) return false;
    const slot = G.inventory[idx];
    if (slot.permanent) return false;

    slot.qty -= qty;
    if (slot.qty <= 0) {
      if (G.isItemEquipped(id)) G.toggleEquipItem(id);
      G.inventory.splice(idx, 1);
      if (G.selectedSlot >= G.inventory.length) G.selectedSlot = 0;
    }
    G.renderInventory();
    G.savePlayerData();
    return true;
  };

  G.getSelectedSlotObj = function getSelectedSlotObj() {
    return G.inventory[G.selectedSlot] || G.inventory[0] || { id: 18, qty: 1, permanent: true };
  };

  function getItemTypeLabel(item, slot) {
    if (!item) return "Item";
    if (slot.permanent) return "Tool";
    if (G.isSeedItem(item)) return "Seed";
    const w = G.wearablesById.get(Number(item.id));
    if (w) return `Wearable - ${w.slot}`;
    if (root.GTWorldCatalog && root.GTWorldCatalog.isBackgroundItem(item)) return "Background";
    return "Block";
  }

  function updatePosBarUI() {
    const bar = document.getElementById("inv-pos-bar");
    const label = document.getElementById("pos-item-label");
    const coords = document.getElementById("pos-coords-label");
    if (!bar) return;

    const active = G.getSelectedSlotObj();
    const w = G.wearablesById.get(Number(active.id));
    const canAdjust = Boolean(posBarOpen && w && G.isItemEquipped(active.id));

    bar.classList.toggle("hidden", !canAdjust);
    if (canAdjust) {
      const off = G.getItemCustomOffset(w.slot, w.id);
      if (label) label.textContent = `POS: ${w.slot.toUpperCase()}`;
      if (coords) coords.textContent = `X: ${off.x}, Y: ${off.y}`;
    }
  }

  G.renderInventory = function renderInventory() {
    const grid = document.getElementById("inv-grid");
    if (!grid) return;
    grid.innerHTML = "";

    G.inventory.forEach((slot, idx) => {
      const item = G.getItem(slot.id);
      const equipped = G.isItemEquipped(slot.id);

      const el = document.createElement("div");
      el.className = "inv-slot" +
        (idx === G.selectedSlot ? " selected" : "") +
        (equipped ? " equipped" : "");
      el.title = item ? item.name : `Item #${slot.id}`;

      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      const cctx = c.getContext("2d");
      cctx.imageSmoothingEnabled = false;
      if (item) {
        G.drawItemIcon(cctx, item, 0, 0, 32);
        if (item.texture && !G.getTilesheet(item.texture)) {
          setTimeout(() => {
            cctx.clearRect(0, 0, 32, 32);
            G.drawItemIcon(cctx, item, 0, 0, 32);
          }, 350);
        }
      }
      el.appendChild(c);

      if (!slot.permanent) {
        const q = document.createElement("span");
        q.className = "inv-qty";
        q.textContent = String(slot.qty);
        el.appendChild(q);
      }

      if (equipped) {
        const eq = document.createElement("span");
        eq.className = "inv-eq-tag";
        eq.textContent = "EQ";
        el.appendChild(eq);
      }

      el.addEventListener("click", () => {
        if (G.selectedSlot === idx && item && G.isWearableItem(item)) {
          G.toggleEquipItem(slot.id);
          G.renderInventory();
          return;
        }
        G.selectedSlot = idx;
        G.playSfx("click", 1.1, 0.35);
        G.renderInventory();
      });

      grid.appendChild(el);
    });

    const active = G.getSelectedSlotObj();
    const activeItem = G.getItem(active.id);
    const nameEl = document.getElementById("inv-selected-name");
    const subEl = document.getElementById("inv-selected-sub");
    const capEl = document.getElementById("inv-capacity-badge");
    const iconCanvas = document.getElementById("inv-selected-icon");
    const btnEquip = document.getElementById("btn-inv-equip");
    const btnPos = document.getElementById("btn-inv-pos");
    const btnDrop = document.getElementById("btn-inv-drop");
    const btnTrash = document.getElementById("btn-inv-trash");

    if (nameEl) {
      nameEl.textContent = activeItem
        ? `${activeItem.name}${active.permanent ? "" : ` (${active.qty})`}`
        : `Item #${active.id}`;
    }
    if (subEl) subEl.textContent = getItemTypeLabel(activeItem, active);
    if (capEl) capEl.textContent = `${G.inventory.length} / ${MAX_SLOTS}`;

    if (iconCanvas) {
      const ictx = iconCanvas.getContext("2d");
      ictx.imageSmoothingEnabled = false;
      ictx.clearRect(0, 0, 32, 32);
      if (activeItem) G.drawItemIcon(ictx, activeItem, 0, 0, 32);
    }

    const canEquip = activeItem && G.isWearableItem(activeItem);
    const isEq = canEquip && G.isItemEquipped(active.id);
    if (btnEquip) {
      btnEquip.style.display = canEquip ? "inline-block" : "none";
      btnEquip.textContent = isEq ? "UNEQUIP" : "EQUIP";
    }
    if (btnPos) {
      btnPos.style.display = isEq ? "inline-block" : "none";
    }
    if (btnDrop) btnDrop.style.display = active.permanent ? "none" : "inline-block";
    if (btnTrash) btnTrash.style.display = active.permanent ? "none" : "inline-block";

    updatePosBarUI();
  };

  /* ─── Drops & Real GT Pickup ─── */
  G.spawnDrop = function spawnDrop(type, id, qty, x, y, vx = 0, vy = -2.2, pickupDelayMs = 350, mustLeave = false) {
    const nowWall = Date.now();
    if (type === "item") {
      for (let i = 0; i < G.drops.length; i++) {
        const d = G.drops[i];
        if (d.type === "item" && d.id === Number(id) && d.qty + qty <= MAX_STACK) {
          if (Math.hypot(d.x - x, d.y - y) < 26) {
            d.qty += Number(qty);
            if (mustLeave) {
              d.mustLeave = true;
              d.canPickupAt = nowWall + pickupDelayMs;
            }
            return;
          }
        }
      }
    }

    G.drops.push({
      uid: Math.random().toString(36).slice(2),
      type,
      id: Number(id),
      qty: Number(qty),
      x: Math.round(x),
      y: Math.round(y),
      vx,
      vy,
      bobPhase: Math.random() * Math.PI * 2,
      mustLeave: Boolean(mustLeave),
      canPickupAt: nowWall + pickupDelayMs
    });
  };

  function updateDrops(dt, wallNow) {
    const w = G.world;
    const p = G.player;
    if (!w || !p) return;

    const ts = Math.min(2.0, dt * 60);
    const pcx = p.x + p.width / 2;
    const pcy = p.y + p.height / 2;

    for (let i = G.drops.length - 1; i >= 0; i--) {
      const d = G.drops[i];

      d.vy = Math.min(6.5, d.vy + 0.35 * ts);
      d.vx *= Math.pow(0.84, ts);
      if (Math.abs(d.vx) < 0.06) d.vx = 0;

      const nextX = d.x + d.vx * ts;
      const nextY = d.y + d.vy * ts;

      const tx = Math.floor(nextX / TILE);
      const ty = Math.floor((nextY + 12) / TILE);
      if (tx >= 0 && tx < w.width && ty >= 0 && ty < w.height) {
        const below = G.getItem(w.fg[ty * w.width + tx]);
        if (G.isSolidTile(below) || G.isPlatformTile(below)) {
          d.y = ty * TILE - 12;
          d.vy = 0;
        } else {
          d.y = nextY;
        }
      } else {
        d.y = nextY;
      }
      d.x = Math.max(12, Math.min(w.width * TILE - 12, nextX));

      const dx = pcx - d.x;
      const dy = pcy - d.y;
      const dist = Math.hypot(dx, dy);

      if (d.mustLeave) {
        if (dist > 44) d.mustLeave = false;
        continue;
      }

      if (!p.isDead && wallNow >= (d.canPickupAt || 0)) {
        if (d.type === "gem" && dist < 32) {
          d.x += (dx / (dist || 1)) * 3.8 * ts;
          d.y += (dy / (dist || 1)) * 3.8 * ts;
        }

        if (dist < 18) {
          if (d.type === "gem") {
            G.gems += d.qty;
            G.updateGemsHUD();
            G.savePlayerData();
            G.playSfx("gem_pickup", 1.0 + Math.random() * 0.15, 0.7);
            spawnFloatingText(d.x, d.y - 8, `+${d.qty} Gems`, "#ffe666");
          } else {
            const it = G.getItem(d.id);
            G.addToInventory(d.id, d.qty);
            G.playSfx("object_collect", 1.0 + Math.random() * 0.1, 0.65);
            spawnFloatingText(d.x, d.y - 8, `+${d.qty} ${it ? it.name : ""}`, "#ffffff");
          }
          G.drops.splice(i, 1);
          scheduleWorldSave();
        }
      }
    }
  }

  function updateEffects(dt, wallNow) {
    const ts = Math.min(2.0, dt * 60);
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const pt = G.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        G.particles.splice(i, 1);
        continue;
      }
      pt.x += pt.vx * ts;
      pt.y += pt.vy * ts;
      pt.vy += 0.22 * ts;
    }

    for (let i = G.floatingTexts.length - 1; i >= 0; i--) {
      const ft = G.floatingTexts[i];
      ft.life -= dt;
      ft.y -= 0.6 * ts;
      if (ft.life <= 0) G.floatingTexts.splice(i, 1);
    }

    G.damage.forEach((dmg, key) => {
      if (wallNow - dmg.lastHitAt > 5000) G.damage.delete(key);
    });
  }

  /* ─── Weather Machine Activation ─── */
  function isWeatherMachine(item) {
    if (!item) return false;
    const act = Number(item.action);
    const n = String(item.name || "").toLowerCase();
    return [41, 81, 89].includes(act) || n.includes("weather machine");
  }

  function activateWeatherMachine(item, tx, ty) {
    const cat = root.GTWorldCatalog;
    if (!cat || !item) return false;
    const raw = String(item.name || "")
      .toLowerCase()
      .replace(/weather machine/g, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .trim();

    const weathers = cat.getWeathers().filter((w) => w.id !== "TRANSPARENT");
    let matched = weathers.find((w) => {
      const wn = w.name.toLowerCase();
      const wid = w.id.toLowerCase().replace(/_/g, " ");
      return raw && (wn.includes(raw) || raw.includes(wn) || wid.includes(raw) || raw.includes(wid));
    });

    if (!matched && raw) {
      const tokens = raw.split(/\s+/).filter((t) => t.length >= 3);
      matched = weathers.find((w) => {
        const hay = `${w.name} ${w.id}`.toLowerCase();
        return tokens.some((t) => hay.includes(t));
      });
    }

    if (!matched) {
      const curIdx = weathers.findIndex((w) => w.id === G.world.weather);
      matched = weathers[(curIdx + 1) % weathers.length];
    }

    if (matched) {
      G.world.weather = matched.id;
      G.getWeatherImage(matched.id);
      G.playSfx("magic", 1.1, 0.7);
      spawnFloatingText(tx * TILE + 16, ty * TILE, matched.name, "#38bdf8");
      G.addChatLine(`Weather changed to ${matched.name}!`, true);
      scheduleWorldSave();
      return true;
    }
    return false;
  }

  /* ─── Tile Interaction: Break, Place, Plant, Harvest, Rayman 3-Tile & Pickaxe ─── */
  function playMaterialHitSfx(item, destroyed) {
    const name = String(item?.name || "").toLowerCase();
    const hasWeaponSfx = typeof G.getHandWeaponInfo === "function" &&
      ["blade", "ranged", "magic"].includes(G.getHandWeaponInfo().type);
    const vol = (hasWeaponSfx && !destroyed) ? 0.35 : 0.7;

    if (name.includes("glass") || name.includes("window")) {
      G.playSfx("punch_glass", 1.0, vol);
    } else if (name.includes("rock") || name.includes("stone") || name.includes("brick") || name.includes("lava")) {
      G.playSfx(destroyed ? "rock_destroy" : "rock_hit", 1.0, vol);
    } else if (name.includes("wood") || name.includes("platform") || name.includes("door")) {
      G.playSfx(destroyed ? "wood_break" : "wood_damage", 1.0, vol);
    } else {
      G.playSfx(destroyed ? "tile_removed" : "punch", 0.95 + Math.random() * 0.1, vol);
    }
  }

  function spawnBlockBreakDrops(item, tx, ty) {
    const cx = tx * TILE + TILE / 2;
    const cy = ty * TILE + TILE / 2;
    const id = Number(item.id);
    let droppedSomething = false;

    if (Math.random() < 0.45) {
      const val = G.getBlockMaxHits(item) >= 4 && Math.random() < 0.25 ? 5 : 1;
      G.spawnDrop("gem", 0, val, cx, cy, (Math.random() - 0.5) * 2.8, -3.0, 300, false);
      droppedSomething = true;
    }

    const seedCandidate = G.getItem(id + 1);
    if (seedCandidate && G.isSeedItem(seedCandidate) && Math.random() < 0.42) {
      G.spawnDrop("item", seedCandidate.id, 1, cx, cy, (Math.random() - 0.5) * 2.6, -2.8, 350, false);
      droppedSomething = true;
    }

    if (Math.random() < 0.65 || !droppedSomething) {
      G.spawnDrop("item", id, 1, cx, cy, (Math.random() - 0.5) * 2.2, -2.5, 350, false);
    }
  }

  function getActionTargets(tx, ty) {
    const w = G.world;
    const p = G.player;
    const targets = [{ x: tx, y: ty }];
    if (!G.hasRayman()) return targets;

    const ptx = Math.floor((p.x + p.width / 2) / TILE);
    const pty = Math.floor((p.y + p.height / 2) / TILE);
    const dx = tx - ptx;
    const dy = ty - pty;

    let sx = p.facing;
    let sy = 0;
    if (dx !== 0 || dy !== 0) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        sx = dx > 0 ? 1 : -1;
        sy = 0;
      } else {
        sx = 0;
        sy = dy > 0 ? 1 : -1;
      }
    }

    for (let step = 1; step <= 2; step++) {
      const nx = tx + sx * step;
      const ny = ty + sy * step;
      if (nx >= 0 && nx < w.width && ny >= 0 && ny < w.height) {
        targets.push({ x: nx, y: ny });
      }
    }
    return targets;
  }

  function punchSingleTile(tx, ty, wallNow, playSound) {
    const w = G.world;
    const idx = ty * w.width + tx;
    const key = `${tx},${ty}`;
    const tcx = tx * TILE + TILE / 2;
    const tcy = ty * TILE + TILE / 2;

    if (G.trees.has(key)) {
      const tree = G.trees.get(key);
      if (wallNow >= tree.plantedAt + tree.growMs) {
        G.trees.delete(key);
        if (playSound) G.playSfx("tree_harvest", 1.0, 0.75);
        spawnBreakParticles(tx, ty, "#4ade80", 8);

        const fruitQty = 2 + Math.floor(Math.random() * 3);
        G.spawnDrop("item", tree.blockId, fruitQty, tcx, tcy, (Math.random() - 0.5) * 2.5, -3.0, 350, false);
        if (Math.random() < 0.55) {
          G.spawnDrop("item", tree.seedId, 1, tcx, tcy, (Math.random() - 0.5) * 2.8, -3.2, 350, false);
        }
        const gemQty = 1 + Math.floor(Math.random() * 4);
        G.spawnDrop("gem", 0, gemQty, tcx, tcy, (Math.random() - 0.5) * 3.0, -3.3, 300, false);
        scheduleWorldSave();
        return true;
      } else {
        if (playSound) {
          const rem = Math.max(1, Math.ceil((tree.plantedAt + tree.growMs - wallNow) / 1000));
          spawnFloatingText(tcx, tcy - 10, `${rem}s`, "#ffffff");
          G.playSfx("punch", 1.2, 0.4);
        }
        return true;
      }
    }

    const hasFg = w.fg[idx] > 0;
    const hasBg = w.bg[idx] > 0;
    if (!hasFg && !hasBg) return false;

    const targetId = hasFg ? w.fg[idx] : w.bg[idx];
    const targetItem = G.getItem(targetId);
    const maxHits = G.getBlockMaxHits(targetItem);

    if (!Number.isFinite(maxHits)) {
      if (playSound) {
        G.playSfx("punch_locked", 1.0, 0.65);
        spawnFloatingText(tcx, tcy - 10, "Unbreakable", "#f87171");
      }
      return true;
    }

    const existingDmg = G.damage.get(key);
    if (hasFg && isWeatherMachine(targetItem) && !existingDmg) {
      activateWeatherMachine(targetItem, tx, ty);
    }

    const dmg = existingDmg || { hits: 0, maxHits, lastHitAt: wallNow };
    dmg.hits += 1;
    dmg.maxHits = maxHits;
    dmg.lastHitAt = wallNow;
    G.damage.set(key, dmg);

    if (dmg.hits >= maxHits) {
      if (hasFg) {
        w.fg[idx] = 0;
        w.flags[idx] = 0;
      } else {
        w.bg[idx] = 0;
      }
      G.damage.delete(key);
      if (playSound) playMaterialHitSfx(targetItem, true);
      spawnBreakParticles(tx, ty, G.getSeedColor(targetId), 7);
      spawnBlockBreakDrops(targetItem, tx, ty);
      scheduleWorldSave();
    } else {
      if (playSound) playMaterialHitSfx(targetItem, false);
      spawnBreakParticles(tx, ty, G.getSeedColor(targetId), 3);
    }
    return true;
  }

  function interactTile(tx, ty) {
    const w = G.world;
    const p = G.player;
    if (!w || !p || p.isDead) return;
    if (tx < 0 || tx >= w.width || ty < 0 || ty >= w.height) return;
    if (p.punchCooldown > 0) return;

    const pcx = p.x + p.width / 2;
    const pcy = p.y + p.height / 2;
    const tcx = tx * TILE + TILE / 2;
    const tcy = ty * TILE + TILE / 2;
    const handInfo = G.getHandWeaponInfo();
    const reach = (handInfo.type === "rayman" || handInfo.type === "ranged" || handInfo.type === "magic")
      ? TILE * 4.5
      : TILE * 3.3;
    if (Math.hypot(tcx - pcx, tcy - pcy) > reach) return;

    const slot = G.getSelectedSlotObj();
    const activeItemId = Number(slot.id);
    const activeItem = G.getItem(activeItemId);
    const idx = ty * w.width + tx;
    const key = `${tx},${ty}`;
    const wallNow = Date.now();

    if (activeItemId === 32) {
      p.punchCooldown = 0.3;
      const fgItem = G.getItem(w.fg[idx]);
      if (fgItem && isWeatherMachine(fgItem)) {
        activateWeatherMachine(fgItem, tx, ty);
        return;
      }
      if (G.trees.has(key)) {
        const tree = G.trees.get(key);
        const rem = Math.max(0, Math.ceil((tree.plantedAt + tree.growMs - wallNow) / 1000));
        const bItem = G.getItem(tree.blockId);
        G.addChatLine(
          rem > 0
            ? `${bItem ? bItem.name : "Tree"}: ${rem}s remaining.`
            : `${bItem ? bItem.name : "Tree"} is ready to harvest!`,
          true
        );
      } else {
        const target = fgItem || G.getItem(w.bg[idx]);
        G.addChatLine(target ? `Inspect: ${target.name} (ID ${target.id})` : "Empty space.", true);
      }
      return;
    }

    if (activeItemId === 18) {
      p.punchCooldown = G.hasPickaxe() ? 0.18 : 0.22;
      const targets = getActionTargets(tx, ty);
      const lastT = targets[targets.length - 1];
      G.triggerPunchAnim(lastT.x, lastT.y, { isBlockBreak: true });

      let hitAny = false;
      targets.forEach((t) => {
        if (punchSingleTile(t.x, t.y, wallNow, !hitAny)) {
          hitAny = true;
        }
      });
      if (!hitAny && handInfo.type === "none") G.playSfx("punch_miss", 1.0, 0.5);
      return;
    }

    if (activeItem && G.isSeedItem(activeItem)) {
      const targets = getActionTargets(tx, ty);
      let plantedCount = 0;

      for (let i = 0; i < targets.length; i++) {
        const hasMore = G.inventory.find((s) => Number(s.id) === activeItemId && s.qty > 0);
        if (!hasMore) break;

        const t = targets[i];
        const tIdx = t.y * w.width + t.x;
        const tKey = `${t.x},${t.y}`;
        if (w.fg[tIdx] !== 0 || G.trees.has(tKey)) continue;

        const belowItem = t.y + 1 < w.height ? G.getItem(w.fg[(t.y + 1) * w.width + t.x]) : null;
        if (!G.isSolidTile(belowItem) && !G.isPlatformTile(belowItem)) {
          if (i === 0) spawnFloatingText(tcx, tcy - 10, "Need ground", "#f87171");
          continue;
        }

        G.trees.set(tKey, {
          seedId: activeItemId,
          blockId: Math.max(2, activeItemId - 1),
          plantedAt: wallNow,
          growMs: G.getGrowTimeMs(activeItem)
        });
        G.removeFromInventory(activeItemId, 1);
        plantedCount++;
      }

      if (plantedCount > 0) {
        G.triggerPunchAnim(tx, ty, { isBlockBreak: false });
        G.playSfx("tree_plant", 1.0, 0.75);
        scheduleWorldSave();
      }
      p.punchCooldown = 0.2;
      return;
    }

    if (activeItem && G.isWearableItem(activeItem)) {
      p.punchCooldown = 0.3;
      G.toggleEquipItem(activeItem.id);
      G.renderInventory();
      return;
    }

    if (activeItem) {
      const isBg = root.GTWorldCatalog && root.GTWorldCatalog.isBackgroundItem(activeItem);
      const targets = getActionTargets(tx, ty);
      let placedCount = 0;

      for (let i = 0; i < targets.length; i++) {
        const hasMore = G.inventory.find((s) => Number(s.id) === activeItemId && s.qty > 0);
        if (!hasMore) break;

        const t = targets[i];
        const tIdx = t.y * w.width + t.x;
        const tKey = `${t.x},${t.y}`;

        if (isBg) {
          if (w.bg[tIdx] !== 0) continue;
          w.bg[tIdx] = activeItemId;
        } else {
          if (w.fg[tIdx] !== 0 || G.trees.has(tKey)) continue;
          if (G.isSolidTile(activeItem)) {
            const overlapX = p.x + p.width > t.x * TILE && p.x < (t.x + 1) * TILE;
            const overlapY = p.y + p.height > t.y * TILE && p.y < (t.y + 1) * TILE;
            if (overlapX && overlapY) continue;
          }
          w.fg[tIdx] = activeItemId;
        }

        G.removeFromInventory(activeItemId, 1);
        placedCount++;
      }

      if (placedCount > 0) {
        G.triggerPunchAnim(tx, ty, { isBlockBreak: false });
        const isLock = String(activeItem.name || "").toLowerCase().includes("lock");
        G.playSfx(isLock ? "use_lock" : "tile_created", 1.0, 0.7);
        scheduleWorldSave();
      }
      p.punchCooldown = 0.16;
    }
  }

  /* ─── REAL GROWTOPIA STORE CATALOG ─── */
  function findExactOrFirst(exactName, preferWearable = false, fallbackId = null) {
    const low = exactName.toLowerCase();
    const pool = preferWearable ? G.allWearables : G.allItems;
    if (fallbackId !== null) {
      const byId = (preferWearable ? G.wearablesById : G.itemsById).get(Number(fallbackId));
      if (byId) return byId;
    }
    return (
      pool.find((x) => String(x.name || "").toLowerCase() === low) ||
      pool.find((x) => String(x.name || "").toLowerCase().includes(low)) ||
      null
    );
  }

  function describeStoreItem(item, fallbackDesc) {
    if (fallbackDesc) return fallbackDesc;
    const n = String(item.name || "").toLowerCase();
    if (Number(item.id) === 5480 || /raym|r.yman/.test(n)) return "3-Tile Punch & Place Power";
    if (/pickaxe|chainsaw|drill|axe/.test(n)) return "Mining Swing + Faster Break";
    if (/sword|scythe|katana|blade/.test(n)) return "Glowing Slash Attack Effect";
    if (/gun|ak-|laser|blaster|bow/.test(n)) return "Ranged Projectile Attack";
    if (/wand|staff|scepter/.test(n)) return "Magic Spell Cast Effect";
    if (n.includes("air robinson")) return "Speed + High Jump Boots";
    if (n.includes("magplant")) return "Auto-Collect Machine";
    if (n.includes("vending") || n.includes("digivend")) return "Shop & Storage Machine";
    if (n.includes("weather machine")) return "Change World Weather";
    if (item.slot === "Back") return "Double Jump + Glide";
    if (item.slot) return `Wearable (${item.slot})`;
    if (G.isSeedItem(item)) return "Plantable Farming Seed";
    return item.category || "World Item";
  }

  function getShopItems(tab, query) {
    const q = query.trim().toLowerCase();
    let list = [];

    if (tab === "special") {
      const specialDefs = [
        { name: "Rayman's Fist",      id: 5480, wear: true,  price: 500, qty: 1, desc: "3-Tile Punch & Place!" },
        { name: "Pickaxe",            id: 98,   wear: true,  price: 120, qty: 1, desc: "Mining Swing (-1 Hit Break)" },
        { name: "Apocalypse Scythe",  id: null, wear: true,  price: 240, qty: 1, desc: "Green Heavy Slash Arc" },
        { name: "AK-8087",            id: 4464, wear: true,  price: 220, qty: 1, desc: "Ranged Shot + Muzzle Flash" },
        { name: "Sword",              id: 94,   wear: true,  price: 100, qty: 1, desc: "Classic Sword Slash" },
        { name: "Air Robinsons",      id: 496,  wear: true,  price: 200, qty: 1, desc: "High Speed + Super Jump" },
        { name: "Magplant 5000",      id: null, wear: false, price: 400, qty: 1, desc: "Harvest & Storage Machine" },
        { name: "Vending Machine",    id: null, wear: false, price: 150, qty: 1, desc: "Sell / Store Items" },
        { name: "DigiVend Machine",   id: null, wear: false, price: 220, qty: 1, desc: "Digital Vending Machine" },
        { name: "World Lock",         id: null, wear: false, price: 200, qty: 1, desc: "Lock Your World" },
        { name: "Diamond Lock",       id: null, wear: false, price: 500, qty: 1, desc: "100 World Locks Value" },
        { name: "Blue Gem Lock",      id: null, wear: false, price: 900, qty: 1, desc: "100 Diamond Locks Value" },
        { name: "Angel Wings",        id: null, wear: true,  price: 180, qty: 1, desc: "Double Jump + Wing Flap" },
        { name: "Da Vinci Wings",     id: null, wear: true,  price: 350, qty: 1, desc: "Heavy Wing Flap + Glide" },
        { name: "Aurora Wings",       id: null, wear: true,  price: 260, qty: 1, desc: "Fairy Sparkle + Glide" },
        { name: "Weather Machine - Night",  id: null, wear: false, price: 150, qty: 1, desc: "Switch to Night Sky" },
        { name: "Weather Machine - Spooky", id: null, wear: false, price: 150, qty: 1, desc: "Switch to Spooky Sky" },
        { name: "Weather Machine - Sunset", id: null, wear: false, price: 150, qty: 1, desc: "Switch to Sunset Sky" },
        { name: "Weather Machine - Snowy",  id: null, wear: false, price: 150, qty: 1, desc: "Switch to Snowy Sky" },
        { name: "Weather Machine - Sunny",  id: null, wear: false, price: 100, qty: 1, desc: "Switch back to Sunny" }
      ];

      const seen = new Set();
      specialDefs.forEach((def) => {
        const it = findExactOrFirst(def.name, def.wear, def.id);
        if (it && !seen.has(it.id)) {
          seen.add(it.id);
          list.push({ item: it, price: def.price, qty: def.qty, desc: def.desc });
        }
      });
    } else if (tab === "starter") {
      const starterNames = [
        "World Lock", "Small Lock", "Big Lock", "Wooden Platform",
        "Door", "Dungeon Door", "Wood Block", "Dirt", "Dirt Seed",
        "Lava", "Lava Seed", "Rock", "Grass", "Cave Background",
        "Sign", "Mushroom", "Pinball Bumper", "Ladder"
      ];
      starterNames.forEach((n) => {
        const found = findExactOrFirst(n, false);
        if (found) {
          list.push({
            item: found,
            price: n.includes("World Lock") ? 200 : n.includes("Lock") ? 50 : 15,
            qty: n.includes("Lock") ? 1 : 10,
            desc: describeStoreItem(found)
          });
        }
      });
    } else if (tab === "wings") {
      const wings = G.allWearables.filter((w) => w.slot === "Back");
      wings.sort((a, b) => {
        const aw = String(a.name || "").toLowerCase().includes("wing") ? 0 : 1;
        const bw = String(b.name || "").toLowerCase().includes("wing") ? 0 : 1;
        return aw - bw;
      });
      list = wings.map((w) => ({ item: w, price: 150, qty: 1, desc: describeStoreItem(w) }));
    } else if (tab === "wearables") {
      list = G.allWearables
        .filter((w) => w.slot !== "Back")
        .map((w) => ({ item: w, price: 55, qty: 1, desc: describeStoreItem(w) }));
    } else if (tab === "blocks") {
      list = G.allItems
        .filter((it) => it && it.id > 0 && it.texture && !G.isWearableItem(it) && !String(it.name || "").startsWith("Item #"))
        .map((it) => ({ item: it, price: 20, qty: 10, desc: describeStoreItem(it) }));
    } else {
      list = G.allItems
        .filter((it) => it && it.id > 0 && it.texture && !String(it.name || "").startsWith("Item #"))
        .map((it) => ({
          item: it,
          price: G.isWearableItem(it) ? 75 : 25,
          qty: G.isWearableItem(it) ? 1 : 10,
          desc: describeStoreItem(it)
        }));
    }

    if (q) {
      list = list.filter((e) =>
        String(e.item.name || "").toLowerCase().includes(q) ||
        String(e.item.id).includes(q)
      );
    }
    return list;
  }

  function renderShopGrid() {
    const grid = document.getElementById("shop-grid");
    const search = document.getElementById("shop-search");
    const countLabel = document.getElementById("shop-count-label");
    const moreBtn = document.getElementById("btn-shop-more");
    if (!grid) return;
    grid.innerHTML = "";

    const allMatches = getShopItems(activeShopTab, search ? search.value : "");
    const visible = allMatches.slice(0, shopVisibleLimit);

    if (countLabel) {
      countLabel.textContent = `${visible.length.toLocaleString()} / ${allMatches.length.toLocaleString()}`;
    }
    if (moreBtn) {
      moreBtn.style.display = visible.length < allMatches.length ? "inline-block" : "none";
    }

    const gemSprite = typeof G.getPixelGemCanvas === "function" ? G.getPixelGemCanvas("yellow") : null;

    visible.forEach(({ item, price, qty, desc }) => {
      const card = document.createElement("div");
      card.className = "shop-card";

      const iconBox = document.createElement("div");
      iconBox.className = "shop-card-icon-box";
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      const cctx = c.getContext("2d");
      cctx.imageSmoothingEnabled = false;
      G.drawItemIcon(cctx, item, 0, 0, 32);
      if (item.texture && !G.getTilesheet(item.texture)) {
        setTimeout(() => {
          cctx.clearRect(0, 0, 32, 32);
          G.drawItemIcon(cctx, item, 0, 0, 32);
        }, 350);
      }
      iconBox.appendChild(c);

      const mid = document.createElement("div");
      mid.className = "shop-card-mid";
      const name = document.createElement("div");
      name.className = "shop-card-name";
      name.textContent = qty > 1 ? `${item.name} x${qty}` : item.name;
      const descEl = document.createElement("div");
      descEl.className = "shop-card-desc";
      descEl.textContent = desc || `#${item.id}`;
      mid.append(name, descEl);

      const buyPill = document.createElement("div");
      buyPill.className = "shop-buy-pill";
      if (gemSprite) {
        const gc = document.createElement("canvas");
        gc.width = 14;
        gc.height = 14;
        gc.style.width = "13px";
        gc.style.height = "13px";
        gc.style.imageRendering = "pixelated";
        const gctx = gc.getContext("2d");
        gctx.imageSmoothingEnabled = false;
        gctx.drawImage(gemSprite, 0, 0, 14, 14);
        buyPill.appendChild(gc);
      }
      const pText = document.createElement("span");
      pText.textContent = price.toLocaleString();
      buyPill.appendChild(pText);

      card.append(iconBox, mid, buyPill);
      card.addEventListener("click", () => {
        if (G.gems < price) {
          G.playSfx("bleep_fail", 1.0, 0.6);
          G.addChatLine(`Not enough gems! Need ${price} Gems.`, true);
          return;
        }
        G.gems -= price;
        G.updateGemsHUD();
        G.addToInventory(item.id, qty);
        G.playSfx("cash_register", 1.0, 0.7);
        G.addChatLine(`Purchased ${item.name} x${qty}!`, true);
      });

      grid.appendChild(card);
    });
  }

  /* ─── UI & Input Bindings ─── */
  function screenToTile(clientX, clientY) {
    const rect = G.canvas.getBoundingClientRect();
    const wx = (clientX - rect.left - G.viewport.x) / G.viewport.zoom;
    const wy = (clientY - rect.top - G.viewport.y) / G.viewport.zoom;
    return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) };
  }

  function setupBindings() {
    const canvas = G.canvas;
    const gameRoot = document.getElementById("game-root");

    canvas.addEventListener("pointerdown", (e) => {
      if (e.button === 2) return;
      G.getAudioCtx();
      isPointerDownOnCanvas = true;
      pointerTile = screenToTile(e.clientX, e.clientY);
      G.hoveredTile = pointerTile;
      interactTile(pointerTile.x, pointerTile.y);
    });

    canvas.addEventListener("pointermove", (e) => {
      const t = screenToTile(e.clientX, e.clientY);
      G.hoveredTile = t;
      pointerTile = t;
    });

    root.addEventListener("pointerup", () => {
      isPointerDownOnCanvas = false;
    });

    document.getElementById("btn-fullscreen")?.addEventListener("click", toggleFullscreen);
    document.getElementById("btn-menu-fullscreen")?.addEventListener("click", () => {
      toggleFullscreen();
      document.getElementById("modal-world")?.classList.add("hidden");
    });
    document.addEventListener("fullscreenchange", () => {
      updateFullscreenUI();
      resizeCanvas();
    });
    document.addEventListener("webkitfullscreenchange", () => {
      updateFullscreenUI();
      resizeCanvas();
    });

    document.getElementById("btn-zoom-in")?.addEventListener("click", () => {
      applyZoom(G.viewport.zoom + 0.25);
      G.playSfx("click", 1.15, 0.35);
    });
    document.getElementById("btn-zoom-out")?.addEventListener("click", () => {
      applyZoom(G.viewport.zoom - 0.25);
      G.playSfx("click", 0.9, 0.35);
    });

    const hudSlider = document.getElementById("hud-scale-slider");
    hudSlider?.addEventListener("input", (e) => applyHudScale(e.target.value));
    document.getElementById("btn-hud-reset")?.addEventListener("click", () => {
      applyHudScale(100);
      G.playSfx("click", 1.0, 0.35);
    });

    function bindCtrl(el, key) {
      if (!el) return;
      const down = (e) => {
        e.preventDefault();
        G.getAudioCtx();
        el.classList.add("active");
        G.player.keys[key] = true;
      };
      const up = (e) => {
        e.preventDefault();
        el.classList.remove("active");
        G.player.keys[key] = false;
      };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("pointerleave", up);
    }

    bindCtrl(document.getElementById("ctrl-left"), "left");
    bindCtrl(document.getElementById("ctrl-right"), "right");
    bindCtrl(document.getElementById("ctrl-jump"), "jump");
    bindCtrl(document.getElementById("ctrl-punch"), "punch");

    root.addEventListener("keydown", (e) => {
      if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "a" || e.key === "ArrowLeft") G.player.keys.left = true;
      if (k === "d" || e.key === "ArrowRight") G.player.keys.right = true;
      if (k === "w" || e.key === "ArrowUp") { G.player.keys.up = true; G.player.keys.jump = true; }
      if (k === "s" || e.key === "ArrowDown") G.player.keys.down = true;
      if (e.key === " ") { e.preventDefault(); G.player.keys.punch = true; }
      if (e.key === "Enter") {
        e.preventDefault();
        toggleChatInput(true);
      }
    });

    root.addEventListener("keyup", (e) => {
      const k = e.key.toLowerCase();
      if (k === "a" || e.key === "ArrowLeft") G.player.keys.left = false;
      if (k === "d" || e.key === "ArrowRight") G.player.keys.right = false;
      if (k === "w" || e.key === "ArrowUp") { G.player.keys.up = false; G.player.keys.jump = false; }
      if (k === "s" || e.key === "ArrowDown") G.player.keys.down = false;
      if (e.key === " ") G.player.keys.punch = false;
    });

    // 3-State Chat Handle
    const chatBox = document.getElementById("gt-chat-box");
    const chatHandle = document.getElementById("chat-handle-btn");
    const chatHandleImg = document.getElementById("chat-handle-img");
    const chatLog = document.getElementById("chat-log");

    function setChatState(nextState, silent = false) {
      const st = DRAWER_STATES.includes(nextState) ? nextState : "normal";
      chatBox.setAttribute("data-state", st);
      if (chatHandleImg) {
        chatHandleImg.src = st === "expanded"
          ? "tilesheets/interface/handle_up.png"
          : "tilesheets/interface/handle_down.png";
      }
      if (chatLog && st !== "collapsed") chatLog.scrollTop = chatLog.scrollHeight;
      if (!silent) G.playSfx("click", 1.0, 0.3);
      try { localStorage.setItem("gt_surv_chat_state", st); } catch (_) {}
    }

    const savedChatState = localStorage.getItem("gt_surv_chat_state");
    if (savedChatState) setChatState(savedChatState, true);

    let chatDragY = 0;
    let chatDragged = false;
    chatHandle?.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      chatDragY = e.clientY;
      chatDragged = false;
      chatHandle.setPointerCapture?.(e.pointerId);
    });
    chatHandle?.addEventListener("pointermove", (e) => {
      if (!chatDragY) return;
      const dy = e.clientY - chatDragY;
      if (Math.abs(dy) >= 22) {
        const curIdx = DRAWER_STATES.indexOf(chatBox.getAttribute("data-state") || "normal");
        const nextIdx = dy > 0 ? Math.min(2, curIdx + 1) : Math.max(0, curIdx - 1);
        if (nextIdx !== curIdx) setChatState(DRAWER_STATES[nextIdx]);
        chatDragged = true;
        chatDragY = e.clientY;
      }
    });
    chatHandle?.addEventListener("pointerup", () => {
      if (!chatDragged && chatDragY) {
        const curIdx = DRAWER_STATES.indexOf(chatBox.getAttribute("data-state") || "normal");
        setChatState(DRAWER_STATES[(curIdx + 1) % 3]);
      }
      chatDragY = 0;
      chatDragged = false;
    });

    // 3-State Bottom Inventory Handle
    const drawer = document.getElementById("inv-drawer");
    const handleBtn = document.getElementById("inv-handle-btn");
    const handleImg = document.getElementById("inv-handle-img");

    function setInvState(nextState, silent = false) {
      const st = DRAWER_STATES.includes(nextState) ? nextState : "normal";
      drawer.setAttribute("data-state", st);
      if (gameRoot) gameRoot.classList.toggle("inv-collapsed", st === "collapsed");
      if (handleImg) {
        handleImg.src = st === "expanded"
          ? "tilesheets/interface/handle_down.png"
          : "tilesheets/interface/handle_up.png";
      }
      if (st !== "expanded") posBarOpen = false;
      updatePosBarUI();
      if (!silent) G.playSfx("click", 1.0, 0.35);
      try { localStorage.setItem("gt_surv_inv_state", st); } catch (_) {}
    }

    const savedInvState = localStorage.getItem("gt_surv_inv_state");
    if (savedInvState) setInvState(savedInvState, true);

    let handleStartY = 0;
    let handleDragged = false;
    handleBtn?.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handleStartY = e.clientY;
      handleDragged = false;
      handleBtn.setPointerCapture?.(e.pointerId);
    });
    handleBtn?.addEventListener("pointermove", (e) => {
      if (!handleStartY) return;
      const dy = e.clientY - handleStartY;
      if (Math.abs(dy) >= 22) {
        const curIdx = DRAWER_STATES.indexOf(drawer.getAttribute("data-state") || "normal");
        const nextIdx = dy < 0 ? Math.min(2, curIdx + 1) : Math.max(0, curIdx - 1);
        if (nextIdx !== curIdx) setInvState(DRAWER_STATES[nextIdx]);
        handleDragged = true;
        handleStartY = e.clientY;
      }
    });
    handleBtn?.addEventListener("pointerup", () => {
      if (!handleDragged && handleStartY) {
        const curIdx = DRAWER_STATES.indexOf(drawer.getAttribute("data-state") || "normal");
        setInvState(DRAWER_STATES[(curIdx + 1) % 3]);
      }
      handleStartY = 0;
      handleDragged = false;
    });

    // Inventory Action Buttons (Equip / POS / Drop / Trash)
    document.getElementById("btn-inv-equip")?.addEventListener("click", () => {
      const slot = G.getSelectedSlotObj();
      if (G.toggleEquipItem(slot.id)) G.renderInventory();
    });

    document.getElementById("btn-inv-pos")?.addEventListener("click", () => {
      posBarOpen = !posBarOpen;
      G.playSfx("click", 1.1, 0.35);
      updatePosBarUI();
    });

    function nudgeActive(dx, dy) {
      const active = G.getSelectedSlotObj();
      const w = G.wearablesById.get(Number(active.id));
      if (!w || !G.isItemEquipped(active.id)) return;
      G.nudgeItemCustomOffset(w.slot, w.id, dx, dy);
      G.playSfx("click", 1.2, 0.25);
      updatePosBarUI();
    }

    document.getElementById("btn-pos-left")?.addEventListener("click", () => nudgeActive(-1, 0));
    document.getElementById("btn-pos-right")?.addEventListener("click", () => nudgeActive(1, 0));
    document.getElementById("btn-pos-up")?.addEventListener("click", () => nudgeActive(0, -1));
    document.getElementById("btn-pos-down")?.addEventListener("click", () => nudgeActive(0, 1));
    document.getElementById("btn-pos-reset")?.addEventListener("click", () => {
      const active = G.getSelectedSlotObj();
      const w = G.wearablesById.get(Number(active.id));
      if (!w) return;
      G.resetItemCustomOffset(w.slot, w.id);
      G.playSfx("click", 0.9, 0.35);
      updatePosBarUI();
    });
    document.getElementById("btn-pos-done")?.addEventListener("click", () => {
      posBarOpen = false;
      updatePosBarUI();
    });

    const modalDrop = document.getElementById("modal-drop");
    const dropQtyInput = document.getElementById("drop-qty-input");
    const dropTitle = document.getElementById("drop-modal-title");

    document.getElementById("btn-inv-drop")?.addEventListener("click", () => {
      const slot = G.getSelectedSlotObj();
      if (slot.permanent) return;
      pendingDropSlotIdx = G.selectedSlot;
      const it = G.getItem(slot.id);
      if (dropTitle) dropTitle.textContent = `DROP ${it ? it.name.toUpperCase() : "ITEM"}`;
      if (dropQtyInput) {
        dropQtyInput.max = String(slot.qty);
        dropQtyInput.value = "1";
      }
      modalDrop.classList.remove("hidden");
    });

    document.getElementById("close-modal-drop")?.addEventListener("click", () => modalDrop.classList.add("hidden"));
    document.getElementById("btn-drop-all")?.addEventListener("click", () => {
      const slot = G.inventory[pendingDropSlotIdx];
      if (slot && dropQtyInput) dropQtyInput.value = String(slot.qty);
    });

    document.getElementById("btn-drop-confirm")?.addEventListener("click", () => {
      const slot = G.inventory[pendingDropSlotIdx];
      if (!slot || slot.permanent) return;
      const qty = Math.max(1, Math.min(slot.qty, parseInt(dropQtyInput.value, 10) || 1));
      const p = G.player;

      const dropX = p.x + p.width / 2 + p.facing * TILE;
      const dropY = p.y + p.height / 2;

      G.removeFromInventory(slot.id, qty);
      G.spawnDrop("item", slot.id, qty, dropX, dropY, p.facing * 1.4, -2.0, 600, true);
      G.playSfx("object_spawn", 1.0, 0.7);
      scheduleWorldSave();
      modalDrop.classList.add("hidden");
    });

    document.getElementById("btn-inv-trash")?.addEventListener("click", () => {
      const slot = G.getSelectedSlotObj();
      if (slot.permanent) return;
      const it = G.getItem(slot.id);
      if (confirm(`Trash all ${slot.qty}x ${it ? it.name : "item"}?`)) {
        G.removeFromInventory(slot.id, slot.qty);
        G.playSfx("trash", 1.0, 0.7);
      }
    });

    // Chat Input
    const chatWrap = document.getElementById("chat-input-wrap");
    const chatInput = document.getElementById("chat-input");

    function toggleChatInput(forceOpen) {
      const open = typeof forceOpen === "boolean" ? forceOpen : chatWrap.classList.contains("hidden");
      chatWrap.classList.toggle("hidden", !open);
      if (open) chatInput.focus();
    }

    function sendChat() {
      const raw = (chatInput.value || "").trim();
      chatInput.value = "";
      toggleChatInput(false);
      if (!raw) return;

      if (raw.startsWith("/")) {
        const parts = raw.slice(1).split(/\s+/);
        const cmd = parts[0].toLowerCase();
        if (cmd === "respawn") {
          G.respawnPlayer();
          G.addChatLine("Respawned at Main Door.", true);
        } else if (cmd === "gems") {
          G.gems += 2000;
          G.updateGemsHUD();
          G.savePlayerData();
          G.playSfx("gem_pickup", 1.0, 0.7);
          G.addChatLine("Added +2,000 Gems.", true);
        } else if (cmd === "warp" && parts[1]) {
          G.enterWorld(parts[1]);
        } else {
          G.addChatLine("Commands: /respawn, /gems, /warp WORLDNAME", true);
        }
        return;
      }

      G.player.chatText = raw;
      G.player.chatTimer = 4.5;
      G.addChatLine(raw, false, G.player.name);
      G.playSfx("msg", 1.0, 0.45);
    }

    document.getElementById("btn-chat-toggle")?.addEventListener("click", () => toggleChatInput());
    document.getElementById("btn-chat-send")?.addEventListener("click", sendChat);
    chatInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChat();
      if (e.key === "Escape") toggleChatInput(false);
    });

    // World, Display Name & Settings Menu Modal
    const modalWorld = document.getElementById("modal-world");
    const nameInput = document.getElementById("player-name-input");
    const warpInput = document.getElementById("world-warp-input");
    const savedList = document.getElementById("saved-worlds-list");

    function openWorldModal() {
      updateFullscreenUI();
      if (nameInput) nameInput.value = G.player.name || "Growtopian";
      if (warpInput) warpInput.value = G.world ? G.world.name : "START";
      if (savedList) {
        savedList.innerHTML = "";
        G.listSavedWorlds().forEach((name) => {
          const b = document.createElement("button");
          b.className = "gt-btn";
          b.textContent = name;
          b.addEventListener("click", () => {
            G.enterWorld(name);
            modalWorld.classList.add("hidden");
          });
          savedList.appendChild(b);
        });
      }
      modalWorld.classList.remove("hidden");
    }

    document.getElementById("hud-profile-card")?.addEventListener("click", openWorldModal);
    document.getElementById("btn-menu-open")?.addEventListener("click", openWorldModal);
    document.getElementById("close-modal-world")?.addEventListener("click", () => modalWorld.classList.add("hidden"));

    document.getElementById("btn-save-name")?.addEventListener("click", () => {
      const cleaned = String(nameInput.value || "").trim().slice(0, 16);
      if (!cleaned) return;
      G.player.name = cleaned;
      const hudName = document.getElementById("hud-player-name");
      if (hudName) hudName.textContent = cleaned;
      G.savePlayerData();
      G.addChatLine(`Display name changed to ${cleaned}.`, true);
      G.playSfx("click", 1.1, 0.4);
    });

    document.getElementById("btn-do-warp")?.addEventListener("click", () => {
      if (warpInput.value.trim()) {
        G.enterWorld(warpInput.value.trim());
        modalWorld.classList.add("hidden");
      }
    });
    document.getElementById("btn-menu-respawn")?.addEventListener("click", () => {
      G.respawnPlayer();
      modalWorld.classList.add("hidden");
    });
    document.getElementById("btn-menu-save")?.addEventListener("click", () => {
      G.saveWorld();
      G.savePlayerData();
      G.addChatLine("World and inventory saved.", true);
      modalWorld.classList.add("hidden");
    });
    document.getElementById("btn-menu-reset-world")?.addEventListener("click", () => {
      if (confirm(`Reset world ${G.world.name} to default?`)) {
        G.enterWorld(G.world.name, true);
        modalWorld.classList.add("hidden");
      }
    });

    // Real Growtopia Store Modal
    const modalShop = document.getElementById("modal-shop");
    function openShopModal() {
      shopVisibleLimit = SHOP_PAGE_SIZE;
      G.updateGemsHUD();
      if (typeof G.renderStaticGemIcons === "function") G.renderStaticGemIcons();
      renderShopGrid();
      modalShop.classList.remove("hidden");
      G.playSfx("dialog_open", 1.0, 0.5);
    }

    document.getElementById("btn-shop-open")?.addEventListener("click", openShopModal);
    document.getElementById("btn-gems-plus")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openShopModal();
    });
    document.getElementById("close-modal-shop")?.addEventListener("click", () => modalShop.classList.add("hidden"));

    document.getElementById("shop-tabs")?.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-tab]");
      if (!btn) return;
      activeShopTab = btn.dataset.tab;
      shopVisibleLimit = SHOP_PAGE_SIZE;
      document.querySelectorAll("#shop-tabs button").forEach((b) => b.classList.toggle("active", b === btn));
      renderShopGrid();
    });

    document.getElementById("shop-search")?.addEventListener("input", () => {
      shopVisibleLimit = SHOP_PAGE_SIZE;
      renderShopGrid();
    });

    document.getElementById("btn-shop-more")?.addEventListener("click", () => {
      shopVisibleLimit += SHOP_PAGE_SIZE;
      renderShopGrid();
    });
  }

  /* ─── Main Game Loop & Bootstrap ─── */
  function resizeCanvas() {
    const dpr = root.devicePixelRatio || 1;
    G.canvas.width = Math.floor(root.innerWidth * dpr);
    G.canvas.height = Math.floor(root.innerHeight * dpr);
  }

  let lastTs = 0;
  function tick(ts) {
    requestAnimationFrame(tick);

    if (!lastTs) lastTs = ts;
    const dt = Math.max(0, Math.min(0.05, (ts - lastTs) / 1000));
    lastTs = ts;

    try {
      const wallNow = Date.now();

      if (isPointerDownOnCanvas) {
        interactTile(pointerTile.x, pointerTile.y);
      } else if (G.player.keys.punch) {
        const p = G.player;
        const fx = Math.floor((p.x + p.width / 2 + p.facing * 26) / TILE);
        const fy = Math.floor((p.y + p.height / 2) / TILE);
        interactTile(fx, fy);
      }

      G.updatePlayer(dt);
      updateDrops(dt, wallNow);
      updateEffects(dt, wallNow);

      const dpr = root.devicePixelRatio || 1;
      const viewW = G.canvas.width / dpr;
      const viewH = G.canvas.height / dpr;

      G.ctx.save();
      G.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      G.renderWorld(G.ctx, viewW, viewH, ts);
      G.ctx.restore();

      if (typeof G.renderMiniAvatar === "function") {
        G.renderMiniAvatar(ts);
      }
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (msg !== lastLoggedErr) {
        lastLoggedErr = msg;
        G.addChatLine(`ERR: ${msg}`, true);
      }
    }
  }

  async function bootstrap() {
    G.canvas = document.getElementById("game-canvas");
    G.ctx = G.canvas.getContext("2d");
    resizeCanvas();
    root.addEventListener("resize", resizeCanvas);

    G.trimHudIcons();
    if (typeof G.renderStaticGemIcons === "function") G.renderStaticGemIcons();

    const savedZoom = parseFloat(localStorage.getItem("gt_surv_zoom"));
    if (Number.isFinite(savedZoom)) {
      applyZoom(savedZoom);
    } else {
      applyZoom(root.innerWidth < 768 ? 1.55 : 2.0);
    }
    const savedHud = parseInt(localStorage.getItem("gt_surv_hud_scale"), 10);
    applyHudScale(Number.isFinite(savedHud) ? savedHud : 100);

    const bar = document.getElementById("load-bar-fill");
    const status = document.getElementById("load-status");
    const screen = document.getElementById("loading-screen");

    try {
      await G.loadDatabases((pct, msg) => {
        if (bar) bar.style.width = `${pct}%`;
        if (status) status.textContent = msg;
      });
    } catch (err) {
      if (status) status.textContent = `Error: ${err.message}`;
      return;
    }

    G.restorePlayerEquipment();
    G.updateGemsHUD();
    G.renderInventory();
    setupBindings();
    updateFullscreenUI();

    if (screen) screen.classList.add("hidden");
    G.addChatLine("Weapon VFX active! Try Rayman, Pickaxe, Scythe, or AK-8087.", true);

    setInterval(() => {
      G.saveWorld();
      G.savePlayerData();
    }, 15000);
    root.addEventListener("beforeunload", () => {
      G.saveWorld();
      G.savePlayerData();
    });

    requestAnimationFrame(tick);
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})(window); 