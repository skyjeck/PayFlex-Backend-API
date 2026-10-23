/**
 * LoanNotificationController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles push notifications for active loan repayments. Notifications are:
 *   • Saved to the database (via NotificationModel)
 *   • Delivered in real-time to the user's Socket.io room (if connected)
 *
 * Scheduled Job Triggers (call `startLoanNotificationScheduler` once at boot):
 *   • Daily 08:00 AM – scans all active ("disbursed") loans and sends:
 *       ➤ 7-day advance reminder
 *       ➤ 3-day advance reminder
 *       ➤ 1-day advance reminder
 *       ➤ Same-day (due today) reminder
 *       ➤ Overdue alert with accrued late-penalty amount
 *
 * Manual / Admin API Endpoints:
 *   POST /api/loan/notifications/run-job   – Manually trigger the full scan
 *   POST /api/loan/notifications/send-user – Send an ad-hoc notice to one user
 *   GET  /api/loan/notifications/preview/:loanId – Dry-run preview for a loan
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Loan from "../models/LoanModel.js";
import User from "../models/UserModel.js";
import Notification from "../models/NotificationModel.js";

// ─── Formatters ───────────────────────────────────────────────────────────────

/**
 * Format an amount as a Nigerian Naira (₦) string.
 * @param {number} amount
 * @returns {string}
 */
const formatNaira = (amount) =>
  `₦${Number(amount).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Return the calendar difference in whole days between two dates (no time).
 * Positive value means targetDate is in the future.
 * @param {Date} targetDate
 * @param {Date} [from=now]
 * @returns {number}
 */
const daysDiff = (targetDate, from = new Date()) => {
  const msPerDay = 1_000 * 60 * 60 * 24;
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  const base = new Date(from);
  base.setHours(0, 0, 0, 0);
  return Math.round((target - base) / msPerDay);
};

// ─── Core Notification Helper ─────────────────────────────────────────────────

/**
 * Persist a notification to MongoDB and optionally emit it to the user's
 * Socket.io room for real-time delivery.
 *
 * @param {object}  params
 * @param {string}  params.userId   – Mongoose ObjectId string
 * @param {string}  params.title    – Notification headline
 * @param {string}  params.message  – Notification body
 * @param {string}  [params.type]   – NotificationModel type enum value
 * @param {object}  [params.data]   – Extra metadata attached to the record
 * @param {object}  [params.io]     – Socket.io server instance (optional)
 * @returns {Promise<object|null>}  The saved notification document or null
 */
const pushNotification = async ({
  userId,
  title,
  message,
  type = "INFO",
  data = {},
  io = null,
}) => {
  try {
    const notification = await Notification.create({
      userId,
      title,
      message,
      type,
      data,
    });

    // Real-time delivery: emit to the user's private Socket.io room
    if (io) {
      io.to(String(userId)).emit("notification", {
        _id: notification._id,
        title,
        message,
        type,
        data,
        isRead: false,
        createdAt: notification.createdAt,
      });
    }

    return notification;
  } catch (err) {
    console.error("[LoanNotifications] pushNotification error:", err.message);
    return null;
  }
};

// ─── Penalty Calculator ───────────────────────────────────────────────────────

/**
 * Compute the total outstanding late-penalty amount across all overdue
 * installments for a loan.
 *
 * @param {object} loan – Mongoose Loan document
 * @returns {{ totalPenalty: number, overdueInstallments: Array }}
 */
const computeOutstandingPenalties = (loan) => {
  const now = new Date();
  const penaltyRate = (loan.latePenaltyPercentage || 5.0) / 100;
  let totalPenalty = 0;
  const overdueInstallments = [];

  for (const item of loan.amortizationSchedule) {
    if (item.status === "paid") continue;
    const dueDate = new Date(item.dueDate);
    if (dueDate >= now) continue;

    // Use persisted penalty if already calculated, else derive flat rate
    const penalty =
      item.penaltyAmount > 0
        ? item.penaltyAmount
        : Number((item.totalEMI * penaltyRate).toFixed(2));

    totalPenalty += penalty;
    overdueInstallments.push({
      installmentNumber: item.installmentNumber,
      dueDate: item.dueDate,
      totalEMI: item.totalEMI,
      penaltyAmount: penalty,
      totalOwed: Number((item.totalEMI + penalty).toFixed(2)),
    });
  }

  return { totalPenalty: Number(totalPenalty.toFixed(2)), overdueInstallments };
};

// ─── Per-Loan Notification Logic ──────────────────────────────────────────────

/**
 * Evaluate a single disbursed loan and send the appropriate notification(s).
 *
 * @param {object}      loan       – Lean Loan document
 * @param {string}      firstName  – User first name for personalisation
 * @param {object|null} io         – Socket.io server instance
 */
const evaluateAndNotifyLoan = async (loan, firstName, io) => {
  const userId = String(loan.userId);
  const now = new Date();

  // ── 1. Overdue / Penalty Alerts ───────────────────────────────────────────
  const { totalPenalty, overdueInstallments } =
    computeOutstandingPenalties(loan);

  if (overdueInstallments.length > 0) {
    const count = overdueInstallments.length;
    const oldestDue = overdueInstallments[0];
    const totalOwed = overdueInstallments.reduce(
      (sum, i) => sum + i.totalOwed,
      0
    );

    await pushNotification({
      userId,
      io,
      type: "TRANSACTION",
      title: "Overdue Loan Payment - Action Required",
      message:
        `Hi ${firstName}, you have ${count} overdue loan installment${count > 1 ? "s" : ""} ` +
        `on your ${loan.purpose} loan. ` +
        `The earliest was due on ${new Date(oldestDue.dueDate).toDateString()}. ` +
        `Total amount owed (including ${formatNaira(totalPenalty)} late penalty): ` +
        `${formatNaira(Number(totalOwed.toFixed(2)))}. ` +
        `Please repay immediately to avoid further charges.`,
      data: {
        loanId: loan._id,
        purpose: loan.purpose,
        overdueCount: count,
        totalPenalty,
        totalOwed: Number(totalOwed.toFixed(2)),
        overdueInstallments,
        remainingBalance: loan.remainingBalance,
      },
    });
  }

  // ── 2. Upcoming Due-Date Reminders ────────────────────────────────────────
  const nextInstallment = loan.amortizationSchedule.find(
    (item) => item.status !== "paid"
  );

  if (!nextInstallment) return;

  const dueInDays = daysDiff(nextInstallment.dueDate, now);

  // Only fire on reminder thresholds; skip negative (already overdue)
  const reminderThresholds = [7, 3, 1, 0];
  if (dueInDays < 0 || !reminderThresholds.includes(dueInDays)) return;

  const dueDateStr = new Date(nextInstallment.dueDate).toDateString();
  const penaltyAmount = Number(
    ((nextInstallment.totalEMI * (loan.latePenaltyPercentage || 5.0)) / 100).toFixed(2)
  );
  const penaltyInfo = `A late penalty of ${formatNaira(penaltyAmount)} will be added if payment is not received on time.`;

  let title, message;

  if (dueInDays === 0) {
    title = "Loan Repayment Due Today!";
    message =
      `Hi ${firstName}, your loan installment #${nextInstallment.installmentNumber} ` +
      `for your ${loan.purpose} loan is due TODAY (${dueDateStr}). ` +
      `Amount due: ${formatNaira(nextInstallment.totalEMI)}. ` +
      `Remaining loan balance: ${formatNaira(loan.remainingBalance)}. ` +
      penaltyInfo;
  } else if (dueInDays === 1) {
    title = "Loan Repayment Due Tomorrow";
    message =
      `Hi ${firstName}, a friendly reminder that installment #${nextInstallment.installmentNumber} ` +
      `on your ${loan.purpose} loan is due tomorrow (${dueDateStr}). ` +
      `Amount due: ${formatNaira(nextInstallment.totalEMI)}. ` +
      penaltyInfo;
  } else {
    title = `Upcoming Loan Payment in ${dueInDays} Days`;
    message =
      `Hi ${firstName}, installment #${nextInstallment.installmentNumber} ` +
      `on your ${loan.purpose} loan is due on ${dueDateStr} (${dueInDays} days away). ` +
      `Amount due: ${formatNaira(nextInstallment.totalEMI)}. ` +
      `Remaining balance: ${formatNaira(loan.remainingBalance)}. ` +
      `Ensure your wallet is funded to avoid a late penalty of ${formatNaira(penaltyAmount)}.`;
  }

  await pushNotification({
    userId,
    io,
    type: "TRANSACTION",
    title,
    message,
    data: {
      loanId: loan._id,
      purpose: loan.purpose,
      installmentNumber: nextInstallment.installmentNumber,
      dueDate: nextInstallment.dueDate,
      amountDue: nextInstallment.totalEMI,
      remainingBalance: loan.remainingBalance,
      dueInDays,
      penaltyIfLate: penaltyAmount,
    },
  });
};

// ─── Full Batch Scan ──────────────────────────────────────────────────────────

/**
 * Scan ALL active ("disbursed") loans and fire the appropriate notifications.
 * Called by the scheduler and the admin manual-trigger endpoint.
 *
 * @param {object|null} io – Socket.io server instance
 * @returns {Promise<{ processed: number, notified: number, errors: number }>}
 */
export const runLoanNotificationJob = async (io = null) => {
  const startTime = Date.now();
  console.log(
    `[LoanNotifications] Starting notification scan at ${new Date().toISOString()}`
  );

  let processed = 0;
  let notified = 0;
  let errors = 0;

  try {
    const activeLoans = await Loan.find({ status: "disbursed" })
      .select(
        "userId purpose monthlyEMI remainingBalance totalRepayment " +
          "amortizationSchedule nextDueDate latePenaltyPercentage createdAt"
      )
      .lean();

    if (activeLoans.length === 0) {
      console.log("[LoanNotifications] No active loans found. Job done.");
      return { processed: 0, notified: 0, errors: 0 };
    }

    // Batch-fetch user names to avoid N+1 queries
    const uniqueUserIds = [
      ...new Set(activeLoans.map((l) => String(l.userId))),
    ];

    const users = await User.find({ _id: { $in: uniqueUserIds } })
      .select("_id firstName")
      .lean();

    const userMap = Object.fromEntries(
      users.map((u) => [String(u._id), u.firstName || "Valued Customer"])
    );

    for (const loan of activeLoans) {
      processed++;
      try {
        const firstName = userMap[String(loan.userId)] || "Valued Customer";
        await evaluateAndNotifyLoan(loan, firstName, io);
        notified++;
      } catch (loanErr) {
        errors++;
        console.error(
          `[LoanNotifications] Error processing loan ${loan._id}:`,
          loanErr.message
        );
      }
    }
  } catch (err) {
    console.error("[LoanNotifications] Fatal job error:", err.message);
    errors++;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(
    `[LoanNotifications] Job complete - Processed: ${processed}, Notified: ${notified}, Errors: ${errors} (${elapsed}s)`
  );

  return { processed, notified, errors };
};

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Start a daily in-process scheduler that fires the loan notification job
 * every day at 08:00 AM server local time.
 *
 * Call this ONCE in index.js after the server starts listening.
 *
 * @param {object} app – Express app instance (used to retrieve `io`)
 */
export const startLoanNotificationScheduler = (app) => {
  const scheduleNextRun = () => {
    const now = new Date();
    const next = new Date(now);

    next.setHours(8, 0, 0, 0); // Target 08:00:00 today

    // If 08:00 AM has already passed today, schedule for tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    const msUntilNext = next - now;

    console.log(
      `[LoanNotifications] Next run scheduled for ${next.toLocaleString()} ` +
        `(in ${Math.round(msUntilNext / 60000)} minutes)`
    );

    setTimeout(async () => {
      const io = app?.get("io") || null;
      await runLoanNotificationJob(io);
      scheduleNextRun(); // Reschedule for the following day
    }, msUntilNext);
  };

  scheduleNextRun();
};

// ─── API Route Handlers ───────────────────────────────────────────────────────

/**
 * POST /api/loan/notifications/run-job
 * Admin-only: manually trigger the full notification scan.
 */
export const triggerLoanNotificationJob = async (req, res) => {
  try {
    const io = req.app?.get("io") || null;
    const result = await runLoanNotificationJob(io);

    return res.status(200).json({
      success: true,
      message: "Loan notification job completed.",
      result,
    });
  } catch (err) {
    console.error("[LoanNotifications] triggerLoanNotificationJob:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/loan/notifications/send-user
 * Admin-only: send an ad-hoc loan notification to a specific user.
 *
 * Body: { userId, title, message, data? }
 */
export const sendAdHocLoanNotification = async (req, res) => {
  try {
    const { userId, title, message, data } = req.body;

    if (!userId || !title || !message) {
      return res.status(400).json({
        success: false,
        message: "userId, title, and message are required.",
      });
    }

    const io = req.app?.get("io") || null;

    const notification = await pushNotification({
      userId,
      title,
      message,
      type: "TRANSACTION",
      data: data || {},
      io,
    });

    if (!notification) {
      return res
        .status(500)
        .json({ success: false, message: "Failed to create notification." });
    }

    return res.status(201).json({
      success: true,
      message: "Notification sent successfully.",
      notification,
    });
  } catch (err) {
    console.error("[LoanNotifications] sendAdHocLoanNotification:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/loan/notifications/preview/:loanId
 * User-facing: preview notification state for a specific loan (dry-run).
 * Nothing is saved or emitted.
 */
export const previewLoanNotification = async (req, res) => {
  try {
    const userId = req.userId;
    const { loanId } = req.params;

    const loan = await Loan.findOne({
      _id: loanId,
      userId,
      status: "disbursed",
    }).lean();

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Active disbursed loan not found.",
      });
    }

    const user = await User.findById(userId).select("firstName").lean();
    const firstName = user?.firstName || "Valued Customer";
    const now = new Date();

    const { totalPenalty, overdueInstallments } =
      computeOutstandingPenalties(loan);

    const nextInstallment = loan.amortizationSchedule.find(
      (item) => item.status !== "paid"
    );

    const dueInDays = nextInstallment
      ? daysDiff(nextInstallment.dueDate, now)
      : null;

    return res.status(200).json({
      success: true,
      preview: {
        loanId: loan._id,
        purpose: loan.purpose,
        remainingBalance: loan.remainingBalance,
        latePenaltyPercentage: loan.latePenaltyPercentage,
        overdueInstallments: {
          count: overdueInstallments.length,
          totalPenalty,
          items: overdueInstallments,
        },
        nextInstallment: nextInstallment
          ? {
              installmentNumber: nextInstallment.installmentNumber,
              dueDate: nextInstallment.dueDate,
              dueInDays,
              amountDue: nextInstallment.totalEMI,
              penaltyIfLate: Number(
                (
                  (nextInstallment.totalEMI *
                    (loan.latePenaltyPercentage || 5.0)) /
                  100
                ).toFixed(2)
              ),
              willNotify: [7, 3, 1, 0].includes(dueInDays),
            }
          : null,
      },
    });
  } catch (err) {
    console.error("[LoanNotifications] previewLoanNotification:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
