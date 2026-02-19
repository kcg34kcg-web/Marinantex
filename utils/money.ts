import Decimal from 'decimal.js';

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

export function toMoney(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

export function addMoney(left: Decimal.Value, right: Decimal.Value): Decimal {
  return toMoney(left).add(toMoney(right));
}

export function subMoney(left: Decimal.Value, right: Decimal.Value): Decimal {
  return toMoney(left).sub(toMoney(right));
}

export function mulMoney(left: Decimal.Value, right: Decimal.Value): Decimal {
  return toMoney(left).mul(toMoney(right));
}

export function divMoney(left: Decimal.Value, right: Decimal.Value): Decimal {
  return toMoney(left).div(toMoney(right));
}

export function minMoney(left: Decimal.Value, right: Decimal.Value): Decimal {
  const leftValue = toMoney(left);
  const rightValue = toMoney(right);
  return Decimal.min(leftValue, rightValue);
}

export function maxMoney(left: Decimal.Value, right: Decimal.Value): Decimal {
  const leftValue = toMoney(left);
  const rightValue = toMoney(right);
  return Decimal.max(leftValue, rightValue);
}

export function percentToRatio(percent: Decimal.Value): Decimal {
  return toMoney(percent).div(100);
}

export function toFixedMoney(value: Decimal.Value, scale = 2): string {
  return toMoney(value).toDecimalPlaces(scale).toFixed(scale);
}

export function moneyToCents(value: Decimal.Value): bigint {
  const cents = mulMoney(value, 100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return BigInt(cents.toFixed(0));
}

export function centsToMoney(value: bigint): string {
  return toFixedMoney(divMoney(value.toString(), 100));
}
