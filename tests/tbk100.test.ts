import { describe, expect, it } from 'vitest';
import { allocatePaymentByTbk100 } from '../lib/finance/tbk100';

describe('TBK 100 payment allocation', () => {
  it('keeps principal intact when payment does not cover full expense + interest', () => {
    const result = allocatePaymentByTbk100({
      principal: '100000.00',
      expenseBalance: '500.00',
      accruedInterest: '4500.00',
      paymentAmount: '3000.00',
    });

    expect(result.allocatedToExpense).toBe('500.00');
    expect(result.allocatedToInterest).toBe('2500.00');
    expect(result.allocatedToPrincipal).toBe('0.00');
    expect(result.remainingPrincipal).toBe('100000.00');
    expect(result.remainingInterest).toBe('2000.00');
  });
});
