<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { formatPhoneNumber } from '$lib/utils/phone';

	let { data } = $props();

	let name = $state('');
	let email = $state('');
	let phone = $state(formatPhoneNumber(data.phone || ''));

	function handleCancel() {
		goto('/profiles');
	}
</script>

<div class="min-h-screen bg-[#ECEEF3] p-4">
	<!-- Header -->
	<div class="mb-4 rounded-[3px] bg-white px-4 py-3">
		<h1 class="font-['Inter'] text-xl font-semibold leading-[28px] text-[#717171]">
			Create New Profile
		</h1>
	</div>

	<!-- Form Card -->
	<div class="rounded-lg bg-white p-5">
		<form method="POST" use:enhance>
			<div class="mb-5 grid grid-cols-2 gap-5">
				<!-- Left Column -->
				<div class="flex flex-col gap-5">
					<!-- Name -->
					<div class="flex flex-col gap-2">
						<label
							for="name"
							class="font-['Poppins'] text-base font-medium leading-[23px] tracking-[0.01em] text-[#565656]"
						>
							Name
						</label>
						<input
							id="name"
							name="name"
							type="text"
							bind:value={name}
							class="h-[45px] w-full rounded-[3px] border border-[#929292] bg-white/75 px-3 font-['Inter'] text-base leading-[22px] text-[#929292] outline-none placeholder:text-[#929292]"
						/>
					</div>

					<!-- Email -->
					<div class="flex flex-col gap-2">
						<label
							for="email"
							class="font-['Poppins'] text-base font-medium leading-[23px] tracking-[0.01em] text-[#565656]"
						>
							Email
						</label>
						<input
							id="email"
							name="email"
							type="email"
							bind:value={email}
							class="h-[45px] w-full rounded-[3px] border border-[#929292] bg-white/75 px-3 font-['Inter'] text-base leading-[22px] text-[#929292] outline-none placeholder:text-[#929292]"
						/>
					</div>
				</div>

				<!-- Right Column -->
				<div class="flex flex-col gap-5">
					<!-- Phone -->
					<div class="flex flex-col gap-2">
						<label
							for="phone"
							class="font-['Poppins'] text-base font-medium leading-[23px] tracking-[0.01em] text-[#565656]"
						>
							Phone Number
						</label>
						<input
							id="phone"
							name="phone"
							type="tel"
							bind:value={phone}
							class="h-[45px] w-full rounded-[3px] border border-[#929292] bg-white/75 px-3 font-['Inter'] text-base leading-[22px] text-[#929292] outline-none placeholder:text-[#929292]"
						/>
					</div>
				</div>
			</div>

			<!-- Action Buttons -->
			<div class="flex justify-end gap-4">
				<button
					type="button"
					onclick={handleCancel}
					class="h-[38px] w-[90px] rounded-[5px] border border-[#577AB7] bg-white font-['Poppins'] text-sm font-normal leading-[21px] text-[#577AB7] transition-colors hover:bg-gray-50"
				>
					Cancel
				</button>
				<button
					type="submit"
					class="h-[38px] w-[170px] rounded-[5px] bg-[#577AB7] font-['Poppins'] text-sm font-normal leading-[21px] text-white transition-colors hover:bg-[#4a6ba5]"
				>
					Save New Profile
				</button>
			</div>
		</form>
	</div>
</div>
