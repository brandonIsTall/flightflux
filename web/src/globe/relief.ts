// How far the terrain stands up, shared between the camera rig (eases it in as the camera dives
// into a seat, out on the way back, and keeps the seat above it) and the earth shader (displaces
// the surface by it). A plain mutable like spin: it changes every frame.

export const relief = {
  /** 0 in orbit (a smooth sphere, relief only shaded), 1 in the cockpit. */
  k: 0,
};

/**
 * Lift of the highest pixel (255) at full relief, in globe radii: Everest stands ~0.004 (~25 km
 * stylized, about 3x exaggerated) so ranges break the cockpit horizon.
 */
export const HEIGHT_SCALE = 0.004;
