import { prisma } from '$lib/db';
import { hashPassword, generateToken } from '$lib/auth';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const data = await request.json();
		const email = data.email;
		const password = data.password;

		if (!email || !password) {
			return json({ success: false, error: 'Email and password are required' }, { status: 400 });
		}

		// Check if user already exists
		const existingUser = await prisma.user.findUnique({
			where: { email }
		});

		if (existingUser) {
			return json({ success: false, error: 'Email already exists' }, { status: 400 });
		}

		// Hash password
		const hashedPassword = await hashPassword(password);

		// Create new user
		const newUser = await prisma.user.create({
			data: {
				email,
				password: hashedPassword,
				emailVisibility: true,
				verified: false
			},
			include: {
				company: true
			}
		});

		// Generate token
		const token = await generateToken(newUser);

		console.log('New user created:', newUser);

		return json({
			success: true,
			user: {
				id: newUser.id,
				email: newUser.email,
				name: newUser.name,
				role: newUser.role,
				company: newUser.company,
				emailVisibility: newUser.emailVisibility,
				verified: newUser.verified,
				avatar: newUser.avatar,
				created: newUser.created,
				updated: newUser.updated
			},
			token
		});
	} catch (error: any) {
		console.error('Error during signup:', error);
		return json(
			{ success: false, error: error.message || 'Failed to sign up. Email may already exist.' },
			{ status: 400 }
		);
	}
};
