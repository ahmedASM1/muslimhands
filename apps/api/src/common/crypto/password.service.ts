import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
  /**
   * Precomputed Argon2id hash used only to equalize login timing when the user
   * is missing or not authenticatable. Not a real account password.
   */
  static readonly DUMMY_ARGON2_HASH =
    '$argon2id$v=19$m=65536,t=3,p=4$dC0HsE8KfUqnxw+4S2O1qQ$7//p3TG8i0ta5O8am6gPyMvkdy/+qp6tlHevU1Nj7As';

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  }
}
