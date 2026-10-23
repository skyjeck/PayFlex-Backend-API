/**
 * Calculates the exact payoff amount for settling a loan early today.
 * @param {Object} loan - The Mongoose loan document
 * @returns {Object} Settlement breakdown
 */
export const calculateEarlySettlement = (loan) => {
  const now = new Date();
  const lastPayment = loan.lastPaymentDate ? new Date(loan.lastPaymentDate) : new Date(loan.disbursedAt || loan.createdAt);

  // Calculate remaining principal unpaid across all remaining installments
  const remainingPrincipal = loan.amortizationSchedule
    .filter((item) => item.status !== "paid")
    .reduce((sum, item) => sum + (item.principalAmount - (item.principalPaid || 0)), 0);

  // Calculate days elapsed since last payment/disbursement
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysElapsed = Math.max(1, Math.ceil((now - lastPayment) / msPerDay));

  // Daily interest rate derived from loan interest rate
  const dailyInterestRate = loan.interestRate / 100 / 365;
  const accruedInterest = Number((remainingPrincipal * dailyInterestRate * daysElapsed).toFixed(2));

  // Early settlement fee calculation (percentage of remaining principal)
  let settlementFee = 0;
  if (loan.earlySettlementFeePercentage > 0) {
    settlementFee = Number((remainingPrincipal * (loan.earlySettlementFeePercentage / 100)).toFixed(2));
  }

  // Total required payoff amount
  const totalPayoffAmount = Number((remainingPrincipal + accruedInterest + settlementFee).toFixed(2));

  // Unearned interest waived (savings for the user)
  const originalRemainingTotal = loan.remainingBalance;
  const interestSaved = Number(Math.max(0, originalRemainingTotal - totalPayoffAmount).toFixed(2));

  return {
    remainingPrincipal,
    daysElapsed,
    accruedInterest,
    settlementFee,
    totalPayoffAmount,
    interestSaved,
  };
};

/**
 * Calculates late penalties for overdue unpaid installments.
 * @param {Object} loan - The Mongoose loan document
 * @returns {Object} Penalty details
 */
export const calculateLatePenalties = (loan) => {
  const now = new Date();
  let totalPenalty = 0;
  let penaltyApplied = false;

  const updatedSchedule = loan.amortizationSchedule.map((item) => {
    // If the item is already paid, or it's not due yet, no penalty
    if (item.status === "paid" || new Date(item.dueDate) >= now) {
      return item;
    }

    // Only apply penalty if one hasn't been fully applied yet
    // In a real scenario, this could be daily, but we'll do a one-time flat penalty per overdue EMI
    if ((item.penaltyAmount || 0) === 0) {
      const penaltyPercentage = loan.latePenaltyPercentage || 5.0;
      const penalty = Number((item.totalEMI * (penaltyPercentage / 100)).toFixed(2));
      item.penaltyAmount = penalty;
      totalPenalty += penalty;
      penaltyApplied = true;
    }

    return item;
  });

  return {
    totalPenalty,
    penaltyApplied,
    updatedSchedule,
  };
};