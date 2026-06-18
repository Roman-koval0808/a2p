<script lang="ts">
	const { data } = $props<{
		data: [string, { name: string; inbound: number; outbound: number; total: number }][];
	}>();

	const maxTotal = $derived(
		Math.max(1, ...data.map(([, v]: [string, { total: number }]) => v.total))
	);

	const colors = ['#577AB7', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];
	function color(i: number) {
		return colors[i % colors.length];
	}
</script>

<div class="chart category-bars">
	<div class="bars" role="img" aria-label="Calls by category">
		{#each data as [key, row], i}
			{#if row.total > 0}
				<div class="bar-row">
					<span class="label" title={row.name}>{row.name}</span>
					<div class="bar-track">
						<div
							class="bar-fill"
							style="width: {Math.round((row.total / maxTotal) * 100)}%; background: {color(i)}"
							title="{row.total} calls"
						></div>
					</div>
					<span class="value">{row.total}</span>
				</div>
			{/if}
		{/each}
	</div>
	{#if data.length === 0 || data.every(([, v]: [string, { total: number }]) => v.total === 0)}
		<p class="empty">No call data in this period.</p>
	{/if}
</div>

<style>
	.chart {
		min-height: 120px;
	}
	.bar-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 8px;
	}
	.label {
		flex: 0 0 120px;
		font-size: 12px;
		color: #374151;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bar-track {
		flex: 1;
		height: 20px;
		background: #f3f4f6;
		border-radius: 4px;
		overflow: hidden;
		min-width: 40px;
	}
	.bar-fill {
		height: 100%;
		border-radius: 4px;
		transition: width 0.3s ease;
	}
	.value {
		flex: 0 0 32px;
		font-size: 12px;
		font-weight: 600;
		color: #577ab7;
		text-align: right;
	}
	.empty {
		font-size: 13px;
		color: #9ca3af;
		padding: 24px 0;
		text-align: center;
	}
</style>
