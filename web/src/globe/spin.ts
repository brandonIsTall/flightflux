// The globe group's current rotation about Y, shared between the spinner (writes it every frame)
// and anything that needs world-space positions of things inside the group (the camera rig, the
// sun direction). A plain mutable, not React state: it changes every frame.

export const spin = { y: 0 };
