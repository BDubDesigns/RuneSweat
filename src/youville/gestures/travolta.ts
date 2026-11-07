/**
 * Disco / Travolta door gesture.
 *
 * One hand makes two deliberate diagonal passes across the torso:
 * UP zone (hand high, out to one side) -> LOW zone (hand low, across
 * the midline to the OTHER side) -> UP zone again, each leg inside a
 * finite window. Wrist offsets are body-relative (shoulder midpoint,
 * torso lengths) and side-agnostic: either hand, either direction.
 *
 * Rejected: jitter (never reaches the zones), a single-frame glitch
 * (legMinMs), crossed hands, both arms moving the same way (jumping
 * jacks), tracking loss, and a hand that dawdles (legMaxMs/totalMaxMs).
 * After firing it latches until the raised hand comes down (re-arm).
 */
import type { ArmState, BodyState } from '../../core/bodyState';
import { TRAVOLTA } from '../config';
import type { GestureRecognizer } from '../interaction';

type Hand = 'left' | 'right';
interface Zone {
  kind: 'up' | 'low';
  sign: 1 | -1;
}

function sameZone(a: Zone | null, b: Zone | null): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.sign === b.sign;
}

/** Wrist offset from the shoulder midpoint, in torso lengths (y down). */
export function wristOffset(
  body: BodyState,
  hand: Hand,
): { x: number; y: number } {
  const wx = hand === 'left' ? body.leftWristX : body.rightWristX;
  const wy = hand === 'left' ? body.leftWristY : body.rightWristY;
  const t = Math.max(body.torsoLength, 1e-6);
  return { x: (wx - body.shoulderMidX) / t, y: (wy - body.shoulderY) / t };
}

/** Which zone (if any) a hand is in. */
export function travoltaZoneAt(body: BodyState, hand: Hand): Zone | null {
  const arm: ArmState = hand === 'left' ? body.leftArm : body.rightArm;
  if (!arm.extended) return null;
  const o = wristOffset(body, hand);
  if (o.y <= TRAVOLTA.upMaxY && Math.abs(o.x) >= TRAVOLTA.upMinAbsX) {
    return { kind: 'up', sign: o.x > 0 ? 1 : -1 };
  }
  if (o.y >= TRAVOLTA.lowMinY && Math.abs(o.x) >= TRAVOLTA.lowMinAbsX) {
    return { kind: 'low', sign: o.x > 0 ? 1 : -1 };
  }
  return null;
}

/**
 * Hands together above hip height (clasped, crossed over the chest).
 * A resting hand beside the hip is NOT crossing, even when the working
 * hand swings down past it.
 */
function handsCrossed(body: BodyState): boolean {
  const a = wristOffset(body, 'left');
  const b = wristOffset(body, 'right');
  const aboveHip = Math.min(a.y, b.y) < TRAVOLTA.crossedMaxY;
  return aboveHip && Math.hypot(a.x - b.x, a.y - b.y) < TRAVOLTA.crossedWristsTorso;
}

export class TravoltaRecognizer implements GestureRecognizer {
  public readonly id = 'travolta' as const;

  private hand: Hand | null = null;
  private zones: Zone[] = [];
  /** How many zones of the sequence are matched (0 = idle). */
  private matched = 0;
  private lastInZoneMs = 0;
  private seqStartMs = 0;
  private departed = false;
  private latched = false;
  private lastStepMs: number | null = null;

  public reset(): void {
    this.abandon();
    this.latched = false;
    this.lastStepMs = null;
  }

  public debugPhase(): string {
    if (this.latched) return 'latched';
    return this.matched === 0 ? 'idle' : `pass ${String(this.matched - 1)}/2`;
  }

  private abandon(): void {
    this.hand = null;
    this.zones = [];
    this.matched = 0;
    this.departed = false;
  }

  public update(body: BodyState | null, nowMs: number): boolean {
    if (
      body === null ||
      !body.present ||
      !body.bodyUsable ||
      !Number.isFinite(nowMs)
    ) {
      this.reset();
      return false;
    }
    if (this.lastStepMs !== null && nowMs <= this.lastStepMs) return false;
    this.lastStepMs = nowMs;

    const zoneL = travoltaZoneAt(body, 'left');
    const zoneR = travoltaZoneAt(body, 'right');

    if (this.latched) {
      // Re-arm once no hand is raised (a resting hand sits in the LOW zone).
      if (zoneL?.kind !== 'up' && zoneR?.kind !== 'up') this.latched = false;
      return false;
    }

    const crossed = handsCrossed(body);

    if (this.hand !== null) {
      const mine = this.hand === 'left' ? zoneL : zoneR;
      const theirs = this.hand === 'left' ? zoneR : zoneL;
      // The other hand also raised = jumping jack / flail; crossed
      // hands = both wrists together above the hip. (A hand resting
      // at the hip is fine: it sits in the LOW zone by nature.)
      if ((theirs !== null && theirs.kind === 'up') || crossed) {
        this.abandon();
        return false;
      }
      return this.advance(mine, nowMs);
    }

    // Idle: a sequence starts from the UP zone only, so a hand resting
    // at the side (or crossed over the belly) can never begin it.
    if (crossed) return false;
    for (const [hand, zone, other] of [
      ['left', zoneL, zoneR],
      ['right', zoneR, zoneL],
    ] as const) {
      if (zone !== null && zone.kind === 'up' && other?.kind !== 'up') {
        this.hand = hand;
        this.zones = [
          zone,
          { kind: 'low', sign: zone.sign === 1 ? -1 : 1 },
          zone,
        ];
        this.matched = 1;
        this.lastInZoneMs = nowMs;
        this.departed = false;
        break;
      }
    }
    return false;
  }

  private advance(zone: Zone | null, nowMs: number): boolean {
    const current = this.zones[this.matched - 1] ?? null;
    const next = this.zones[this.matched] ?? null;

    if (sameZone(zone, current)) {
      // Still (or back) in the zone we already matched.
      this.lastInZoneMs = nowMs;
      this.departed = false;
      return false;
    }
    if (!this.departed) {
      this.departed = true;
      if (this.matched === 1) this.seqStartMs = nowMs;
    }
    if (zone === null) {
      // In transit: a leg must finish inside legMaxMs.
      if (nowMs - this.lastInZoneMs > TRAVOLTA.legMaxMs) this.abandon();
      return false;
    }
    if (!sameZone(zone, next)) {
      // A zone that is neither where we were nor where we must go next.
      this.abandon();
      return false;
    }
    const leg = nowMs - this.lastInZoneMs;
    if (leg < TRAVOLTA.legMinMs || leg > TRAVOLTA.legMaxMs) {
      this.abandon();
      return false;
    }
    this.matched += 1;
    this.lastInZoneMs = nowMs;
    this.departed = false;
    if (this.matched < this.zones.length) return false;
    const total = nowMs - this.seqStartMs;
    const ok = total >= TRAVOLTA.totalMinMs && total <= TRAVOLTA.totalMaxMs;
    this.abandon();
    if (!ok) return false;
    this.latched = true;
    return true;
  }
}
