/**
 * Town hub overlay (v3.1): the manual-pause screen. Worker A owns
 * the pause state machine that opens / closes this; this module owns
 * only the overlay itself — what it shows and what its taps do.
 *
 * INTERFACE (for the coordinator wiring it into `main.ts`):
 * ```ts
 * const hub = new TownHub({
 *   onResume: () => { /* close the hub, resume Swing Lab *\/ },
 *   onOpenRefiner: () => { /* switch to the Refiner game *\/ },
 *   onReset: () => { /* save was reset — refresh any cached HUD *\/ },
 * });
 * hub.open();                 // show the hub (pause machine calls this)
 * hub.close();                // hide it (no callback — the caller resumes)
 * hub.isOpen;                 // boolean
 * hub.render(ctx, nowMs);     // draw the overlay; reads the inventory store live
 * hub.handlePointer(x, y);    // canvas-space tap; true when a button was hit
 * hub.handleKey(key);         // ' ' / 'Escape' closes + calls onResume; true when handled
 * hub.snapshot();             // { open, screen, resetArmed } — for tests / debug HUD
 * ```
 * `main.ts` owns the canvas pointer listener and converts client
 * coordinates to canvas space (same pattern as Swing Lab's
 * `pointerDownAt`); it forwards taps to `handlePointer` while the
 * hub is open, and forwards Space / Escape to `handleKey`.
 * Leaving the hub returns to Swing Lab — the hub never switches
 * games itself except through `onOpenRefiner`.
 *
 * WHAT IT SHOWS (main screen):
 * - Inventory: ore by tier with the real images, refined materials,
 *   Credits.
 * - Mines open to you: Ferrite Shale — The Jag; Galvanite — Deep Jag,
 *   locked until Mining 5.
 * - Activity spots: Refiner (playable) and Bix's shop (sell). Other
 *   activities (combat etc.) appear as "coming soon" stubs only —
 *   they are NOT built and NOT tappable.
 *
 * BIX'S SHOP (shop screen): sell ore / refined for Credits at the
 * `BIX` config prices — Sell 1 and Sell all per item. No daily
 * limits (RuneSpace has them; NOT imported). No buying this round.
 * The prices are ACTIVE-GAME-ONLY, not RuneSpace canon (see `BIX`
 * in `core/config.ts`).
 *
 * RESET: the Reset button is two-tap — first tap arms it ("Tap again
 * to confirm"), second tap clears the save via the inventory store
 * and fires `onReset`. A tap anywhere else disarms it.
 */

import { BIX, RENDER } from '../core/config';
import { assetUrl } from '../core/assetUrl';
import {
  inventory,
  type InventoryItemId,
  type InventoryStore,
} from '../core/inventory';
import { MINING_TIERS } from '../games/swing-lab/tiers';

/** Callbacks the coordinator wires to `main.ts` + the game switcher. */
export interface TownHubCallbacks {
  /** Close the hub and resume the current game. */
  onResume: () => void;
  /** Switch to the Refiner game. */
  onOpenRefiner: () => void;
  /** The save was reset (after the two-tap confirm). */
  onReset: () => void;
}

export type TownHubScreen = 'main' | 'shop';

/** Sellable items, in hub display order. */
export const BIX_SELLABLE: readonly {
  id: InventoryItemId;
  name: string;
  image: string;
}[] = [
  { id: 'ferrite-shale', name: 'Ferrite Shale', image: 'item-art/ferrite-shale.webp' },
  { id: 'galvanite', name: 'Galvanite', image: 'item-art/galvanite.webp' },
  { id: 'refined-ferrite', name: 'Refined Ferrite', image: 'item-art/refined-ferrite.webp' },
  { id: 'galvanic-stock', name: 'Galvanic Stock', image: 'item-art/galvanic-stock.webp' },
] as const;

/** Bix's sell price for one unit of `id` (Credits), or undefined. */
export function bixSellPrice(id: InventoryItemId): number | undefined {
  return BIX.sellPrices[id];
}

/**
 * Sell `qty` of `id` from `store` at the Bix price. Returns the
 * Credits gained (0 when nothing was sold — not owned, or no price).
 * Caps at what the player owns.
 */
export function sellItems(
  store: InventoryStore,
  id: InventoryItemId,
  qty: number,
): number {
  const price = bixSellPrice(id);
  if (price === undefined || qty <= 0) return 0;
  const owned = store.count(id);
  const selling = Math.min(Math.floor(qty), owned);
  if (selling <= 0) return 0;
  if (!store.remove(id, selling)) return 0;
  const gained = selling * price;
  store.addCredits(gained);
  return gained;
}

/** Sell exactly one unit. Returns Credits gained (0 when none owned). */
export function sellOne(store: InventoryStore, id: InventoryItemId): number {
  return sellItems(store, id, 1);
}

/** Sell everything owned of `id`. Returns Credits gained. */
export function sellAll(store: InventoryStore, id: InventoryItemId): number {
  return sellItems(store, id, store.count(id));
}

/** Read-only snapshot, for tests / the debug HUD. */
export interface TownHubSnapshot {
  open: boolean;
  screen: TownHubScreen;
  /** Reset is armed (one tap done, waiting for the confirm tap). */
  resetArmed: boolean;
  credits: number;
}

interface LoadedImage {
  img: HTMLImageElement;
  loaded: boolean;
}

function loadImage(relativePath: string): LoadedImage | null {
  if (typeof Image === 'undefined') return null;
  const img = new Image();
  const entry: LoadedImage = { img, loaded: false };
  img.onload = () => {
    entry.loaded = true;
  };
  img.onerror = () => {
    entry.loaded = false;
  };
  img.src = assetUrl(relativePath);
  return entry;
}

interface ButtonRect {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
}

const COMING_SOON: readonly string[] = ['⚔️ Combat — coming soon', '🌲 Lumberjack — coming soon'];

export class TownHub {
  private readonly callbacks: TownHubCallbacks;
  private openFlag = false;
  private screen: TownHubScreen = 'main';
  private resetArmed = false;
  private buttons: ButtonRect[] = [];
  private readonly images = new Map<string, LoadedImage>();

  public constructor(callbacks: TownHubCallbacks) {
    this.callbacks = callbacks;
    for (const item of BIX_SELLABLE) {
      const image = loadImage(item.image);
      if (image !== null) this.images.set(item.id, image);
    }
  }

  /** Show the hub (always opens on the main screen). */
  public open(): void {
    this.openFlag = true;
    this.screen = 'main';
    this.resetArmed = false;
  }

  /** Hide the hub. No callback — the caller resumes the game. */
  public close(): void {
    this.openFlag = false;
    this.resetArmed = false;
  }

  public get isOpen(): boolean {
    return this.openFlag;
  }

  public get currentScreen(): TownHubScreen {
    return this.screen;
  }

  public snapshot(): TownHubSnapshot {
    return {
      open: this.openFlag,
      screen: this.screen,
      resetArmed: this.resetArmed,
      credits: inventory.credits,
    };
  }

  /**
   * Canvas-space tap. Returns true when a hub button was hit (the
   * caller should swallow the tap); false when the tap missed
   * everything (a miss also disarms a pending Reset confirm).
   */
  public handlePointer(x: number, y: number): boolean {
    if (!this.openFlag) return false;
    for (const button of this.buttons) {
      if (x < button.x || x > button.x + button.w || y < button.y || y > button.y + button.h) {
        continue;
      }
      return this.activate(button.action);
    }
    // A tap that missed every button disarms the Reset confirm.
    this.resetArmed = false;
    return false;
  }

  /**
   * Key handling: Space / Escape closes the hub and resumes.
   * Returns true when the key was handled.
   */
  public handleKey(key: string): boolean {
    if (!this.openFlag) return false;
    if (key === ' ' || key === 'Escape' || key === 'Esc') {
      this.close();
      this.callbacks.onResume();
      return true;
    }
    return false;
  }

  /** Draw the overlay. Reads the inventory store live every frame. */
  public render(ctx: CanvasRenderingContext2D, _nowMs: number): void {
    if (!this.openFlag) return;
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    ctx.save();
    // Dim the game behind the menu.
    ctx.fillStyle = 'rgba(8, 8, 14, 0.82)';
    ctx.fillRect(0, 0, width, height);
    if (this.screen === 'shop') this.renderShop(ctx, width, height);
    else this.renderMain(ctx, width, height);
    ctx.restore();
  }

  private activate(action: string): boolean {
    if (action === 'resume') {
      this.close();
      this.callbacks.onResume();
      return true;
    }
    if (action === 'refiner') {
      this.close();
      this.callbacks.onOpenRefiner();
      return true;
    }
    if (action === 'shop') {
      this.screen = 'shop';
      this.resetArmed = false;
      return true;
    }
    if (action === 'shop-back') {
      this.screen = 'main';
      return true;
    }
    if (action === 'reset') {
      if (!this.resetArmed) {
        this.resetArmed = true;
        return true;
      }
      inventory.reset();
      this.resetArmed = false;
      this.callbacks.onReset();
      return true;
    }
    if (action.startsWith('sell-one:')) {
      sellOne(inventory, action.slice('sell-one:'.length) as InventoryItemId);
      return true;
    }
    if (action.startsWith('sell-all:')) {
      sellAll(inventory, action.slice('sell-all:'.length) as InventoryItemId);
      return true;
    }
    // Coming-soon stubs are not buttons; anything else is inert.
    return false;
  }

  private drawHeader(
    ctx: CanvasRenderingContext2D,
    width: number,
    title: string,
  ): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 34px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 6;
    ctx.strokeText(title, width / 2, 48);
    ctx.fillText(title, width / 2, 48);
    ctx.font = `22px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffd166';
    const snap = inventory.snapshot();
    ctx.fillText(
      `💰 ${snap.credits} Credits · ⛏️ Mining Lv ${inventory.level('mining')} · 🔥 Refining Lv ${inventory.level('refining')}`,
      width / 2,
      86,
    );
  }

  private drawButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    action: string,
    opts: { highlight?: boolean; dim?: boolean; fontPx?: number } = {},
  ): void {
    this.buttons.push({ x, y, w, h, action });
    ctx.fillStyle = opts.highlight
      ? 'rgba(255, 209, 102, 0.25)'
      : 'rgba(11, 11, 18, 0.72)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = opts.highlight ? '#ffd166' : 'rgba(232, 232, 240, 0.5)';
    ctx.lineWidth = opts.highlight ? 3 : 2;
    ctx.strokeRect(x, y, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${opts.fontPx ?? 22}px ${RENDER.gameFont}`;
    ctx.fillStyle = opts.dim ? '#b9b9d6' : '#e8e8f0';
    ctx.fillText(label, x + w / 2, y + h / 2);
  }

  private drawItemIcon(
    ctx: CanvasRenderingContext2D,
    id: string,
    x: number,
    y: number,
    size: number,
  ): void {
    const img = this.images.get(id);
    if (img !== undefined && img.loaded) {
      ctx.drawImage(img.img, x - size / 2, y - size / 2, size, size);
      return;
    }
    ctx.fillStyle = '#d97b3f';
    ctx.beginPath();
    ctx.moveTo(x, y - size / 2);
    ctx.lineTo(x + size * 0.35, y);
    ctx.lineTo(x, y + size / 2);
    ctx.lineTo(x - size * 0.35, y);
    ctx.closePath();
    ctx.fill();
  }

  private renderMain(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    this.buttons = [];
    this.drawHeader(ctx, width, '🏠 Town Hub');
    const margin = 24;
    const colW = (width - margin * 3) / 2;
    const leftX = margin;
    const rightX = margin * 2 + colW;
    let y = 116;

    // LEFT: inventory.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 24px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('🎒 Inventory', leftX, y);
    y += 34;
    ctx.font = `20px ${RENDER.gameFont}`;
    for (const item of BIX_SELLABLE) {
      const owned = inventory.count(item.id);
      this.drawItemIcon(ctx, item.id, leftX + 18, y, 30);
      ctx.fillStyle = '#e8e8f0';
      ctx.fillText(`${item.name} × ${owned}`, leftX + 40, y);
      y += 36;
    }

    // LEFT, below inventory: mines.
    y += 10;
    ctx.font = `700 24px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('⛏️ Mines', leftX, y);
    y += 34;
    ctx.font = `20px ${RENDER.gameFont}`;
    const miningLevel = inventory.level('mining');
    for (const tier of MINING_TIERS) {
      const unlocked = miningLevel >= tier.requiredMiningLevel;
      ctx.fillStyle = unlocked ? '#e8e8f0' : '#b9b9d6';
      ctx.fillText(
        unlocked
          ? `⛏️ ${tier.name} — ${tier.location}`
          : `🔒 ${tier.name} — ${tier.location} (Mining ${tier.requiredMiningLevel})`,
        leftX,
        y,
      );
      y += 32;
    }

    // RIGHT: activity spots.
    let ry = 116;
    ctx.font = `700 24px ${RENDER.gameFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText('📍 Activities', rightX, ry);
    ry += 40;
    this.drawButton(
      ctx, rightX, ry, colW, 52, '🔥 Refiner — refine ore', 'refiner', { highlight: true },
    );
    ry += 62;
    this.drawButton(
      ctx, rightX, ry, colW, 52, "🛒 Bix's Shop — sell", 'shop', { highlight: true },
    );
    ry += 62;
    for (const stub of COMING_SOON) {
      ctx.font = `20px ${RENDER.gameFont}`;
      ctx.fillStyle = '#8a8aa8';
      ctx.fillText(stub, rightX, ry + 20);
      ry += 36;
    }

    // BOTTOM: resume + reset.
    const bottomY = height - 64;
    this.drawButton(ctx, margin, bottomY, 260, 48, '▶ Resume (Space)', 'resume', {
      highlight: true,
    });
    this.drawButton(
      ctx,
      width - margin - 260,
      bottomY,
      260,
      48,
      this.resetArmed ? '⚠️ Tap again to confirm reset' : '🗑 Reset save',
      'reset',
      { fontPx: 18 },
    );
  }

  private renderShop(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    this.buttons = [];
    this.drawHeader(ctx, width, "🛒 Bix's Shop — sell");
    const margin = 24;
    const rowW = width - margin * 2;
    let y = 122;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `20px ${RENDER.gameFont}`;
    ctx.fillStyle = '#b9b9d6';
    ctx.fillText('Bix buys your ore and refined goods. No buying this round.', margin, y);
    y += 40;
    for (const item of BIX_SELLABLE) {
      const owned = inventory.count(item.id);
      const price = bixSellPrice(item.id) ?? 0;
      this.drawItemIcon(ctx, item.id, margin + 18, y, 30);
      ctx.font = `22px ${RENDER.gameFont}`;
      ctx.fillStyle = '#e8e8f0';
      ctx.fillText(`${item.name} × ${owned} — ${price} cr each`, margin + 40, y);
      const sellOneW = 110;
      const sellAllW = 130;
      const sellAllX = margin + rowW - sellAllW;
      const sellOneX = sellAllX - 10 - sellOneW;
      this.drawButton(ctx, sellOneX, y - 20, sellOneW, 40, 'Sell 1', `sell-one:${item.id}`, {
        fontPx: 18,
      });
      this.drawButton(ctx, sellAllX, y - 20, sellAllW, 40, 'Sell all', `sell-all:${item.id}`, {
        fontPx: 18,
        highlight: owned > 0,
      });
      y += 52;
    }
    this.drawButton(ctx, margin, height - 64, 220, 48, '⬅ Back to town', 'shop-back', {
      highlight: true,
    });
  }
}
