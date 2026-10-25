'use strict';
const assert = require('node:assert/strict');
const { createGas } = require('../dev/gas-mock');

/** A fresh fake runtime with request helpers. The first account to call becomes the family admin. */
function app(options = {}) {
  const gas = createGas(options);
  const call = (action, payload = {}, as) => gas.request(action, payload, as);
  const ok = (action, payload = {}, as) => {
    const res = call(action, payload, as);
    assert.equal(res.ok, true, `${action} failed: ${JSON.stringify(res.error)}`);
    return res.data;
  };
  const fail = (action, payload, as, code) => {
    const res = call(action, payload, as);
    assert.equal(res.ok, false, `${action} should have failed`);
    if (code) assert.equal(res.error.code, code, `${action}: ${res.error.message}`);
    return res.error;
  };
  return { gas, call, ok, fail };
}

/** An app where owner@example.com has signed in once and owns a seeded family. */
function seeded(options = {}) {
  const a = app(options);
  const data = a.ok('state', {}, 'owner@example.com');
  const family = data.state.family;
  const type = (kind) => family.types.find((t) => t.kind === kind);
  const cat = (name) => family.categories.find((c) => c.name === name);
  return Object.assign(a, { state: data.state, family, familyId: family.id, me: data.state.me, type, cat });
}

/** Adds a person to the seeded family and returns their user id. */
function invite(a, email, name, role = 'member') {
  const d = a.ok('user.save', { familyId: a.familyId, email, name, role, view: { familyId: a.familyId } }, 'owner@example.com');
  return d.result.id;
}

module.exports = { app, seeded, invite, assert };
