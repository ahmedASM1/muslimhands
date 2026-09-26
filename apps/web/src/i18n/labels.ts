import type { TranslateParams } from './translate';

export function movementLabel(
  t: (key: string, params?: TranslateParams) => string,
  type: string,
): string {
  const key = `movement.${type}`;
  const label = t(key);
  return label === key ? type.replaceAll('_', ' ') : label;
}

export function reasonLabel(
  t: (key: string, params?: TranslateParams) => string,
  reason: string,
): string {
  const key = `reason.${reason}`;
  const label = t(key);
  return label === key ? reason.replaceAll('_', ' ') : label;
}
