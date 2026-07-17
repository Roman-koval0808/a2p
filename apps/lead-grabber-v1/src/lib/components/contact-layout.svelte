<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import { Facebook, Instagram } from 'lucide-svelte';
	import * as Dialog from '$lib/components/ui/dialog/index';
	import { toast } from 'svelte-sonner';

	type Contact = {
		id: string;
		name?: string | null;
		phone?: string | null;
		email?: string | null;
		company?: string | null;
		avatarUrl?: string | null;
	};

	let {
		contact,
		onUpdated
	}: { contact: Contact; onUpdated?: (contact: Contact) => void } = $props();

	let name = $state(contact.name ?? '');
	let phone = $state(contact.phone ?? '');
	let email = $state(contact.email ?? '');
	let saving = $state(false);

	// Re-sync the editable fields whenever a different contact is supplied.
	let syncedId = $state(contact.id);
	$effect(() => {
		if (contact.id !== syncedId) {
			syncedId = contact.id;
			name = contact.name ?? '';
			phone = contact.phone ?? '';
			email = contact.email ?? '';
		}
	});

	async function handleSave() {
		if (saving) return;
		saving = true;
		try {
			const res = await fetch(`/api/contacts/${contact.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, phone, email })
			});
			const body = await res.json().catch(() => null);
			if (res.ok && body?.success) {
				toast.success(body.message ?? 'Contact updated');
				onUpdated?.(body.data ?? { ...contact, name, phone, email });
			} else {
				toast.error(body?.error ?? 'Failed to update contact');
			}
		} catch (err) {
			toast.error('Failed to update contact');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Content class="!w-[682px] bg-dialog px-10 pb-4 pt-10">
	<Dialog.Header>
		<Dialog.Title class="py-4">{name || 'Edit Contact'}</Dialog.Title>
		<div class="flex flex-col gap-11">
			<div class="flex flex-col gap-2">
				<div class="flex items-center gap-4">
					<span class="w-20 text-sm">Name:</span>
					<input
						type="text"
						bind:value={name}
						class="w-96 border-b border-gray-300 bg-transparent outline-none"
					/>
				</div>

				<div class="flex items-center gap-4">
					<span class="w-20 text-sm">SMS:</span>
					<input
						type="tel"
						bind:value={phone}
						class="border-b border-gray-300 bg-transparent text-blue-500 outline-none"
					/>
				</div>

				<div class="flex items-center gap-4">
					<span class="w-20 text-sm">Email:</span>
					<input
						type="email"
						bind:value={email}
						class="border-b border-gray-300 bg-transparent text-blue-500 outline-none"
					/>
				</div>
				<div class="flex flex-col gap-4">
					<span class="w-20 text-sm">Channels:</span>
					<div class="flex items-center gap-2">
						<Facebook class="h-6 w-6" />
						<Instagram class="h-6 w-6" />
					</div>
				</div>
			</div>

			<Button class="ml-auto" disabled={saving} onclick={handleSave}>
				{saving ? 'Saving…' : 'Save Changes'}
			</Button>
		</div>
	</Dialog.Header>
</Dialog.Content>
