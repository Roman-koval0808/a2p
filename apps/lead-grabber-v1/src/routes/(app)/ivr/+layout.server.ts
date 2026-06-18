import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { prisma } from '$lib/db';

export const load: LayoutServerLoad = async ({ parent }) => {
	const data = await parent();
	const user = data?.user;
	if (!user?.company?.id) {
		throw redirect(302, '/login');
	}

	const count = await prisma.companyPhoneNumber.count({
		where: { companyId: user.company.id }
	});

	if (count === 0) {
		throw redirect(302, '/manage-numbers?buy_number_first=1');
	}

	return data;
};
