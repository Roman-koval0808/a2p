import { prisma } from '$lib/db';
import { verifyPassword, generateToken, createSessionCookie } from '$lib/auth';
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

		// Find user by email
		const user = await prisma.user.findUnique({
			where: { email },
			include: {
				company: true
			}
		});

		if (!user) {
			return json({ success: false, error: 'Invalid email or password' }, { status: 401 });
		}

		// Verify password
		const isValid = await verifyPassword(password, user.password);
		if (!isValid) {
			return json({ success: false, error: 'Invalid email or password' }, { status: 401 });
		}

		// Update emailVisibility to true
		const updatedUser = await prisma.user.update({
			where: { id: user.id },
			data: { emailVisibility: true },
			include: {
				company: true
			}
		});

		// Generate token
		const token = await generateToken(updatedUser);

		console.log('Authenticated user:', updatedUser);

		return json(
			{
				success: true,
				user: {
					id: updatedUser.id,
					email: updatedUser.email,
					name: updatedUser.name,
					role: updatedUser.role,
					company: updatedUser.company,
					emailVisibility: updatedUser.emailVisibility,
					verified: updatedUser.verified,
					avatar: updatedUser.avatar,
					created: updatedUser.created,
					updated: updatedUser.updated
				},
				token
			},
			{
				headers: {
					'Set-Cookie': createSessionCookie(token)
				}
			}
		);
	} catch (error) {
		console.error('Error during login:', error);
		return json({ success: false, error: 'Invalid email or password' }, { status: 401 });
	}
};
