<script lang="ts">
	import type { MemberRole } from '$lib/types/company_member';
	import { cn } from '$lib/utils';

	let { role } = $props<{ role: MemberRole }>();

	const roleColors = {
		owner: 'bg-purple-100 text-purple-800 border-purple-200',
		admin: 'bg-blue-100 text-blue-800 border-blue-200',
		member: 'bg-gray-100 text-gray-800 border-gray-200'
	};
</script>

<span class={cn('rounded-full border px-2 py-1 text-xs font-medium', roleColors[role])}>
	{role.charAt(0).toUpperCase() + role.slice(1)}
</span>
