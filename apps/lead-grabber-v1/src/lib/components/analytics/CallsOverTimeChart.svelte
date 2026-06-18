<script lang="ts">
	const { data } = $props<{
		data: { date: string; inbound: number; outbound: number }[];
	}>();

	const maxTotal = $derived(
		Math.max(1, ...data.map((d: { inbound: number; outbound: number }) => d.inbound + d.outbound))
	);

	function formatLabel(d: string) {
		const date = new Date(d + 'T12:00:00');
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

<div class="chart calls-over-time">
	<div class="chart-bars" role="img" aria-label="Calls over time">
		{#each data as row}
			{@const total = row.inbound + row.outbound}
			<div
				class="bar-group"
				title="{formatLabel(row.date)}: {row.inbound} inbound, {row.outbound} outbound"
			>
				<div
					class="bar-stack"
					style="height: {total > 0 ? Math.max(4, (total / maxTotal) * 100) : 0}%"
				>
					{#if row.outbound > 0}
						<div
							class="bar segment outbound"
							style="height: {total > 0 ? (row.outbound / total) * 100 : 0}%"
						></div>
					{/if}
					{#if row.inbound > 0}
						<div
							class="bar segment inbound"
							style="height: {total > 0 ? (row.inbound / total) * 100 : 0}%"
						></div>
					{/if}
				</div>
				<span class="bar-label">{formatLabel(row.date)}</span>
			</div>
		{/each}
	</div>
	<div class="chart-legend">
		<span class="legend-item"><span class="dot inbound"></span> Inbound</span>
		<span class="legend-item"><span class="dot outbound"></span> Outbound</span>
	</div>
</div>

<style>
	.chart {
		min-height: 200px;
	}
	.chart-bars {
		display: flex;
		align-items: flex-end;
		gap: 4px;
		height: 180px;
		padding: 8px 0;
	}
	.bar-group {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}
	.bar-stack {
		width: 100%;
		max-width: 32px;
		height: 100%;
		display: flex;
		flex-direction: column-reverse;
		justify-content: flex-end;
		gap: 1px;
		margin: 0 auto;
	}
	.bar.segment {
		min-height: 2px;
		width: 100%;
		border-radius: 2px 2px 0 0;
	}
	.bar.segment.inbound {
		background: #22c55e;
	}
	.bar.segment.outbound {
		background: #3b82f6;
	}
	.bar-label {
		font-size: 10px;
		color: #6b7280;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
		text-align: center;
	}
	.chart-legend {
		display: flex;
		gap: 16px;
		justify-content: center;
		margin-top: 8px;
		font-size: 12px;
		color: #6b7280;
	}
	.legend-item {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.dot.inbound {
		background: #22c55e;
	}
	.dot.outbound {
		background: #3b82f6;
	}
</style>
