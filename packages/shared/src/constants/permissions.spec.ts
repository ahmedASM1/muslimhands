import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_PERMISSION_CODES, PERMISSION_DEFINITIONS } from './permissions.js';
import { ROLE_DEFINITIONS } from './roles.js';
import { RoleCode } from '../enums/index.js';

describe('permission catalog', () => {
  it('contains unique permission codes', () => {
    const unique = new Set(ALL_PERMISSION_CODES);
    assert.equal(unique.size, ALL_PERMISSION_CODES.length);
  });

  it('maps every permission to a definition', () => {
    assert.equal(PERMISSION_DEFINITIONS.length, ALL_PERMISSION_CODES.length);
  });

  it('gives SUPER_ADMIN every permission', () => {
    const superAdmin = ROLE_DEFINITIONS.find((role) => role.code === RoleCode.SUPER_ADMIN);
    assert.ok(superAdmin);
    assert.equal(superAdmin.permissions.length, ALL_PERMISSION_CODES.length);
  });

  it('includes the identity permission catalog', () => {
    const required = [
      'dashboard:view',
      'organization:view',
      'pharmacy:view',
      'warehouse:view',
      'user:view',
      'user:invite',
      'role:view',
      'audit-log:view',
      'settings:manage',
    ];
    for (const code of required) {
      assert.ok(ALL_PERMISSION_CODES.includes(code as (typeof ALL_PERMISSION_CODES)[number]), code);
    }
  });

  it('keeps warehouse staff out of dispensing mutations', () => {
    const staff = ROLE_DEFINITIONS.find((role) => role.code === RoleCode.WAREHOUSE_STAFF);
    assert.ok(staff);
    assert.equal(staff.permissions.includes('dispensing:create'), false);
  });
});
