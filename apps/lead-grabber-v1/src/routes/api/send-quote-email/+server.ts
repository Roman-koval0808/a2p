import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

interface QuoteEmailData {
	customerName: string;
	customerEmail: string;
	customerPhone: string;
	quoteDescription: string;
	firstName?: string;
	lastName?: string;
	tags?: string[];
	ownerEmail?: string;
	isCustomerConfirmation?: boolean;
}

export const POST = (async ({ request, locals }) => {
	try {
		const company = locals.user?.company ?? null;
		const companyName = company?.name || 'Your Company';
		const companyId = company?.id ?? 'Unknown Company';

		const data = (await request.json()) as QuoteEmailData;
		const {
			customerName,
			customerEmail,
			customerPhone,
			quoteDescription,
			tags = ['quote'],
			ownerEmail,
			isCustomerConfirmation = false
		} = data;

		if (!customerEmail || (!quoteDescription && !isCustomerConfirmation)) {
			return json({ success: false, error: 'Missing required fields' }, { status: 400 });
		}

		const { sendEmail } = await import('$lib/server/brevo');

		if (isCustomerConfirmation) {
			await sendEmail({
				to: [{ email: customerEmail, name: customerName }],
				subject: 'Your Quote Request Has Been Received',
				htmlContent: generateCustomerEmailContent({
					customerName,
					quoteDescription,
					customerPhone,
					customerEmail,
					companyName,
					companyId
				})
			});
		} else {
			await sendEmail({
				to: [{ email: ownerEmail, name: companyName }],
				subject: `New Quote Request from ${customerName}`,
				htmlContent: generateOwnerEmailContent({
					customerName,
					quoteDescription,
					customerPhone,
					customerEmail,
					companyName,
					companyId
				})
			});
		}

		return json({
			success: true,
			companyId
		});
	} catch (error) {
		console.error('Error sending quote email:', error);
		return json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
	}
}) satisfies RequestHandler;

function generateCustomerEmailContent({ customerName, quoteDescription, customerPhone, customerEmail, companyName, companyId }) {
	return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 5px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #333;">Thank You for Your Quote Request!</h2>
      </div>

      <p style="font-size: 16px; line-height: 1.5; color: #333;">
        Hello ${customerName},
      </p>

      <p style="font-size: 16px; line-height: 1.5; color: #333;">
        We've received your request for a quote regarding:
      </p>

      <div style="background-color: #f7f7f7; padding: 15px; border-left: 4px solid #4a90e2; margin: 20px 0; border-radius: 4px;">
        <p style="font-size: 16px; line-height: 1.5; color: #333; margin: 0;">
          ${quoteDescription}
        </p>
      </div>

      <p style="font-size: 16px; line-height: 1.5; color: #333;">
        Our team will review your request and get back to you shortly with a detailed quote. We typically respond within 1-2 business days.
      </p>

      <div style="background-color: #f9f9f9; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <h3 style="color: #333; margin-top: 0;">Your Contact Information:</h3>
        <ul style="font-size: 16px; line-height: 1.5; color: #333;">
          <li>Name: ${customerName}</li>
          <li>Phone: ${customerPhone}</li>
          <li>Email: ${customerEmail}</li>
        </ul>
      </div>

      <p style="font-size: 16px; line-height: 1.5; color: #333;">
        If you need to make any changes to your request, please reply to this email or contact our quote department directly.
      </p>

      <p style="font-size: 16px; line-height: 1.5; color: #333;">
        Thank you for considering our services!
      </p>

      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; text-align: center; color: #777; font-size: 14px;">
        <p>&copy; ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
        <p style="font-size: 12px; color: #999;">Reference: #${companyId}-QUOTE-${Date.now().toString(36)}</p>
      </div>
    </div>
  `;
}

function generateOwnerEmailContent({ customerName, quoteDescription, customerPhone, customerEmail, companyName, companyId }) {
	return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 5px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #333;">New Quote Request Received</h2>
        <p style="color: #666; font-size: 14px;">Company ID: ${companyId}</p>
      </div>

      <p style="font-size: 16px; line-height: 1.5; color: #333;">
        A new quote request has been submitted through your website.
      </p>

      <div style="background-color: #f0f7ff; padding: 15px; border-left: 4px solid #4a90e2; margin: 20px 0; border-radius: 4px;">
        <h3 style="color: #333; margin-top: 0;">Customer Information:</h3>
        <ul style="font-size: 16px; line-height: 1.5; color: #333;">
          <li><strong>Name:</strong> ${customerName}</li>
          <li><strong>Phone:</strong> ${customerPhone}</li>
          <li><strong>Email:</strong> ${customerEmail}</li>
        </ul>
      </div>

      <div style="background-color: #f7f7f7; padding: 15px; border-left: 4px solid #4a90e2; margin: 20px 0; border-radius: 4px;">
        <h3 style="color: #333; margin-top: 0;">Quote Request:</h3>
        <p style="font-size: 16px; line-height: 1.5; color: #333; margin: 0;">
          ${quoteDescription}
        </p>
      </div>

      <p style="font-size: 16px; line-height: 1.5; color: #333;">
        Please contact the customer to follow up on this request.
      </p>

      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; text-align: center; color: #777; font-size: 14px;">
        <p>This is an automated message from your quote system.</p>
        <p style="font-size: 12px; color: #999;">Reference: #${companyId}-QUOTE-${Date.now().toString(36)}</p>
      </div>
    </div>
  `;
}