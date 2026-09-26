describe('pharmacy portal login rules', () => {
  function canLoginToPharmacy(input: {
    authenticatable: boolean;
    userPharmacyId: string | null;
    portalPharmacyId: string;
  }) {
    if (!input.authenticatable) return false;
    return input.userPharmacyId === input.portalPharmacyId;
  }

  it('allows invited active pharmacy staff for their pharmacy only', () => {
    expect(
      canLoginToPharmacy({
        authenticatable: true,
        userPharmacyId: 'ph-1',
        portalPharmacyId: 'ph-1',
      }),
    ).toBe(true);
  });

  it('rejects users invited to a different pharmacy', () => {
    expect(
      canLoginToPharmacy({
        authenticatable: true,
        userPharmacyId: 'ph-2',
        portalPharmacyId: 'ph-1',
      }),
    ).toBe(false);
  });

  it('rejects invited-but-not-activated accounts', () => {
    expect(
      canLoginToPharmacy({
        authenticatable: false,
        userPharmacyId: 'ph-1',
        portalPharmacyId: 'ph-1',
      }),
    ).toBe(false);
  });
});
