/**
 * Balance email (Scenario 1 / Mary). Builds the subject + body itemizing what the
 * customer owes, for the approval queue. Sending happens on approval via brevo.
 */
export function buildBalanceEmail(opts: {
	customerName?: string | null;
	balance: number;
	companyName?: string | null;
}): { subject: string; htmlContent: string; text: string } {
	const who = opts.customerName?.trim() || 'there';
	const co = opts.companyName?.trim() || 'our team';
	const amt = `$${opts.balance.toFixed(2)}`;
	const subject = `Your account balance with ${co}`;
	const text = `Hi ${who},

As requested, here is your current account balance with ${co}:

  Total amount owing: ${amt}

Please let us know if you'd like to arrange payment or have any questions.

Thank you,
${co}`;
	const htmlContent = `<p>Hi ${who},</p>
<p>As requested, here is your current account balance with ${co}:</p>
<table style="border-collapse:collapse"><tr><td style="padding:6px 12px;border:1px solid #ddd"><strong>Total amount owing</strong></td><td style="padding:6px 12px;border:1px solid #ddd"><strong>${amt}</strong></td></tr></table>
<p>Please let us know if you'd like to arrange payment or have any questions.</p>
<p>Thank you,<br/>${co}</p>`;
	return { subject, htmlContent, text };
}

/** Whether an inbound billing message asks to be emailed the info (vs. a text/read-out). */
export function wantsEmailedBalance(message: string | null | undefined): boolean {
	return /\b(email|e-mail|send (it|me)|send.*(bill|balance|invoice|statement)|in writing)\b/i.test(
		(message || '').toLowerCase()
	);
}
