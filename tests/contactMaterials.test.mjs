import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTACT_RESTITUTION_FLOOR, contactMaterial } from '../.test-build/sim/contactMaterials.js';

const EPSILON = 0.0000001;

test('wall coefficient times contact coefficient gives Wall Bounce', () => {
  for (const [contact, wall] of [[0.3, 0.3], [0.3, 1], [1, 0.3], [0.05, 0.9], [0.9, 0]]) {
    const material = contactMaterial(contact, wall);
    assert.equal(material.contactRestitution, contact);
    assert.ok(Math.abs(material.contactRestitution * material.wallRestitution - wall) < EPSILON);
    assert.equal(material.wallFriction, 0);
  }
});

test('Contact Bounce 0 uses the floor so the wall coefficient stays finite', () => {
  const material = contactMaterial(0, 0.8);
  assert.equal(material.contactRestitution, CONTACT_RESTITUTION_FLOOR);
  assert.ok(Number.isFinite(material.wallRestitution));
  assert.ok(Math.abs(material.contactRestitution * material.wallRestitution - 0.8) < EPSILON);
});
