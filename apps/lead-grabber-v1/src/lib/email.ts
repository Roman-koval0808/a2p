import nodemailer from 'nodemailer';
import {
	SMTP_HOST,
	SMTP_PORT,
	SMTP_SECURE,
	SMTP_USER,
	SMTP_PASS,
	SMTP_FROM
} from '$env/static/private';

const transporter = nodemailer.createTransport({
	host: SMTP_HOST,
	port: parseInt(SMTP_PORT || '587'),
	secure: SMTP_SECURE === 'true',
	auth: {
		user: SMTP_USER,
		pass: SMTP_PASS
	},
	tls: {
		rejectUnauthorized: false
	}
});

type EmailOptions = {
	to: string;
	subject: string;
	html: string;
};

export async function sendEmail({ to, subject, html }: EmailOptions) {
	try {
		await transporter.sendMail({
			from: SMTP_FROM,
			to,
			subject,
			html
		});
	} catch (error) {
		console.error('Error sending email:', error);
		throw error;
	}
}
