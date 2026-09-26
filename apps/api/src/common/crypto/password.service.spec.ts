import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it(
    'hashes and verifies a password with argon2id',
    async () => {
      const hash = await service.hash('ChangeMeNow!');
      expect(hash.startsWith('$argon2id$')).toBe(true);
      await expect(service.verify(hash, 'ChangeMeNow!')).resolves.toBe(true);
      await expect(service.verify(hash, 'wrong-password')).resolves.toBe(false);
    },
    30000,
  );
});
