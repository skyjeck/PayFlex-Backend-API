/**
 * Builds a month-by-month breakdown of principal and interest
 */
const generateAmortizationSchedule = (principal, annualRate, tenureMonths, startDate = new Date()) => {
  const monthlyRate = annualRate / 100 / 12;
  
  // Calculate exact EMI
  const emi = monthlyRate > 0
    ? (principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) /
      (Math.pow(1 + monthlyRate, tenureMonths) - 1)
    : principal / tenureMonths;

  const monthlyEMI = Number(emi.toFixed(2));
  let currentBalance = principal;
  const schedule = [];

  for (let i = 1; i <= tenureMonths; i++) {
    const interestForMonth = Number((currentBalance * monthlyRate).toFixed(2));
    const principalForMonth = Number((monthlyEMI - interestForMonth).toFixed(2));

    currentBalance = Number(Math.max(0, currentBalance - principalForMonth).toFixed(2));

    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);

    schedule.push({
      installmentNumber: i,
      dueDate,
      principalAmount: principalForMonth,
      interestAmount: interestForMonth,
      totalEMI: monthlyEMI,
      status: "pending",
      amountPaid: 0,
    });
  }

  return { monthlyEMI, schedule };
};