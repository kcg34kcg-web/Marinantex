import type { Tb100Allocation, Tb100PaymentInput } from '@/types/finance';
import { minMoney, subMoney, toFixedMoney } from '@/utils/money';

export function allocatePaymentByTbk100(input: Tb100PaymentInput): Tb100Allocation {
  const payment = input.paymentAmount;

  const allocatedToExpense = minMoney(payment, input.expenseBalance);
  const afterExpense = subMoney(payment, allocatedToExpense);

  const allocatedToInterest = minMoney(afterExpense, input.accruedInterest);
  const afterInterest = subMoney(afterExpense, allocatedToInterest);

  const allocatedToPrincipal = minMoney(afterInterest, input.principal);

  const remainingExpense = subMoney(input.expenseBalance, allocatedToExpense);
  const remainingInterest = subMoney(input.accruedInterest, allocatedToInterest);
  const remainingPrincipal = subMoney(input.principal, allocatedToPrincipal);

  return {
    allocatedToExpense: toFixedMoney(allocatedToExpense),
    allocatedToInterest: toFixedMoney(allocatedToInterest),
    allocatedToPrincipal: toFixedMoney(allocatedToPrincipal),
    remainingExpense: toFixedMoney(remainingExpense),
    remainingInterest: toFixedMoney(remainingInterest),
    remainingPrincipal: toFixedMoney(remainingPrincipal),
  };
}
