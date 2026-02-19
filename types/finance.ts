export interface InterestPeriod {
  startDate: string;
  endDate: string;
  annualRatePercent: string;
}

export interface LedgerEntry {
  id: string;
  caseId: string;
  direction: 'in' | 'out';
  type: 'payment' | 'expense' | 'interest_accrual';
  category: string;
  amount: string;
  currency: 'TRY' | 'USD' | 'EUR' | 'XAU';
  transactionDate: string;
  createdAt: string;
}

export interface TaxConfig {
  isKdvExempt: boolean;
  defaultStopajRate: string;
  defaultKdvRate: string;
}

export interface Tb100PaymentInput {
  principal: string;
  expenseBalance: string;
  accruedInterest: string;
  paymentAmount: string;
}

export interface Tb100Allocation {
  allocatedToExpense: string;
  allocatedToInterest: string;
  allocatedToPrincipal: string;
  remainingExpense: string;
  remainingInterest: string;
  remainingPrincipal: string;
}

export interface InterestRateOverride {
  code: 'yasal' | 'ticari_avans' | 'reeskont';
  annualRatePercent?: string;
}

export interface ExecutionRateOverride {
  tahsilHarciRatePercent?: string;
  prisonFeeRatePercent?: string;
}
