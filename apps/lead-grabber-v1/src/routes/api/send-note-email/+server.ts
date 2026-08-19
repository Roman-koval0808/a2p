import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const data = await request.json();
		const { title, requirements, steps, keep, recipient } = data;

		const requirementsSection = requirements ? `
      <div style="margin-bottom: 20px;">
        <h3 style="color: #333; margin-bottom: 10px;">Requirements</h3>
        <p style="white-space: pre-line;">${requirements}</p>
      </div>
    ` : '';

		const stepsSection = steps ? `
      <div style="margin-bottom: 20px;">
        <h3 style="color: #333; margin-bottom: 10px;">Steps</h3>
        <p style="white-space: pre-line;">${steps}</p>
      </div>
    ` : '';

		const keepSection = keep ? `
      <div style="margin-bottom: 20px;">
        <h3 style="color: #333; margin-bottom: 10px;">Keep</h3>
        <p style="white-space: pre-line;">${keep}</p>
      </div>
    ` : '';

		const { sendEmail } = await import('$lib/server/brevo');

		await sendEmail({
			to: [{ email: recipient }],
			subject: `Notes: ${title}`,
			htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
          <h2 style="color: #4a5568; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid #eee;">${title}</h2>

          ${requirementsSection}
          ${stepsSection}
          ${keepSection}

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #718096; font-size: 0.8em;">
            <p>This email was sent from your notes application.</p>
          </div>
        </div>
      `
		});

		return json({ success: true });
	} catch (error: any) {
		console.error('Error sending notes email:', error);
		return json({ success: false, error: error.message }, { status: 500 });
	}
};