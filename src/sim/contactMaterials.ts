// One collider per body keeps `Wall Bounce` and `Contact Bounce` separate.
// Walls use Rapier's `Multiply` combine rule, which wins over the bodies'
// default `Average` rule. A wall contact then gets
// contact * (wall / contact) = Wall Bounce, and friction 0 * x = 0.
// Body-body contacts average equal values and keep `Contact Bounce`.

// Keeps the wall coefficient finite at Contact Bounce 0. Body-body contacts
// bounce with 0.001 instead of 0, which cannot be felt.
export const CONTACT_RESTITUTION_FLOOR = 0.001;

export type ContactMaterial = {
  contactRestitution: number;
  wallRestitution: number;
  wallFriction: number;
};

export function contactMaterial(contactBounce: number, wallBounce: number): ContactMaterial {
  const contactRestitution = Math.max(contactBounce, CONTACT_RESTITUTION_FLOOR);
  return {
    contactRestitution,
    wallRestitution: Math.max(wallBounce, 0) / contactRestitution,
    wallFriction: 0,
  };
}
