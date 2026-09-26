import { isNavItemActive } from './nav-active';

describe('Phase 6D nav active helper', () => {
  it('marks nested routes active without activating dashboard roots', () => {
    expect(isNavItemActive('/warehouse/stock', '/warehouse/stock')).toBe(true);
    expect(isNavItemActive('/warehouse/stock/details', '/warehouse/stock')).toBe(true);
    expect(isNavItemActive('/warehouse/stock', '/warehouse')).toBe(false);
    expect(isNavItemActive('/administration', '/administration')).toBe(true);
  });
});
