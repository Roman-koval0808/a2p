<script lang="ts">
	import { Button } from '$lib/components/ui/button/index';
	import { Shuffle } from 'lucide-svelte';
	import AssignAgentDialog from '$lib/components/assign-agent-dialog.svelte';

	interface Props {
		selectedMessage?: {
			thread_id?: string;
			customer_name?: string;
			customer_phone?: string;
			id?: string;
			[key: string]: any;
		} | null;
		companyMembers?: Array<{
			id: string;
			name: string;
		}>;
		onTransfer?: (selectedAgentNames: string[]) => void;
	}

	let { selectedMessage = null, companyMembers = [], onTransfer }: Props = $props();

	let transferDialogOpen = $state(false);
	let preSelectedAgents = $state<string[]>([]);

	function handleTransferClick() {
		if (!selectedMessage) {
			return;
		}
		// Get currently assigned member name if any
		const currentMember = companyMembers.find((m) => m.id === selectedMessage?.assigned_to);
		preSelectedAgents = currentMember ? [currentMember.name] : [];
		transferDialogOpen = true;
	}

	function handleTransfer(selectedAgentNames: string[]) {
		if (onTransfer) {
			onTransfer(selectedAgentNames);
		}
		transferDialogOpen = false;
	}
</script>

<Button variant="ghost" class="hover:bg-transparent" onclick={handleTransferClick}>
	<Shuffle class="text-3xl" size="33" />
</Button>

{#if selectedMessage}
	<AssignAgentDialog
		bind:open={transferDialogOpen}
		endpointName={selectedMessage.customer_name || 'Conversation'}
		agents={companyMembers.map((m) => m.name)}
		{preSelectedAgents}
		onAssign={handleTransfer}
	/>
{/if}
