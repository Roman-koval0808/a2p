<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import { Card } from "$lib/components/ui/card";
    import { goto } from "$app/navigation";
    import { Share2, ArrowLeft } from "lucide-svelte";
    import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "$lib/components/ui/dialog";
    import * as Select from "$lib/components/ui/select";
    import { toast } from "svelte-sonner";
    
    let { data } = $props();
    const { video, representatives } = data;

    let selectedRepresentatives = $state(video.shared_with || []);
    let showShareDialog = $state(false);

    function handleRepresentativeChange(value: string) {
        const repId = value;
        if (selectedRepresentatives.includes(repId)) {
            selectedRepresentatives = selectedRepresentatives.filter(id => id !== repId);
        } else {
            selectedRepresentatives = [...selectedRepresentatives, repId];
        }
    }

    async function handleShare() {
        try {
            await fetch(`?/shareVideo`, {
                method: 'POST',
                body: JSON.stringify({ representatives: selectedRepresentatives }),
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            toast.success('Video shared successfully');
            showShareDialog = false;
        } catch (err) {
            console.error('Error sharing video:', err);
            toast.error('Failed to share video');
        }
    }
</script>

<div class="flex bg-[#eceef3]">
    
    <div class="flex-1 overflow-auto">
        <div class="container mx-auto p-6">
            <div class="mb-6 flex justify-between items-center">
                <Button variant="ghost" onclick={() => goto('/content-library')}>
                    <ArrowLeft class="h-4 w-4 mr-2" />
                    Back to Library
                </Button>
                <Button onclick={() => showShareDialog = true}>
                    <Share2 class="h-4 w-4 mr-2" />
                    Share Video
                </Button>
            </div>

            <Card class="overflow-hidden">
                <div class="aspect-video w-full">
                    <video
                        src={video.file}
                        poster={video.thumbnail || undefined}
                        controls
                        class="w-full h-full"
                    >
                        Your browser does not support the video tag.
                    </video>
                </div>
                <div class="p-6">
                    <h1 class="text-2xl font-bold mb-2">{video.title}</h1>
                    {#if video.description}
                        <p class="text-gray-600">{video.description}</p>
                    {/if}
                </div>
            </Card>
        </div>
    </div>
</div>

<!-- Share Dialog -->
<Dialog bind:open={showShareDialog}>
    <DialogContent>
        <DialogHeader>
            <DialogTitle>Share Video</DialogTitle>
            <DialogDescription>
                Choose representatives to share this video with.
            </DialogDescription>
        </DialogHeader>
        <div class="py-4">
            <Select.Root multiple portal={null}>
                <Select.Trigger class="w-full">
                    {selectedRepresentatives.length > 0
                        ? selectedRepresentatives.map(id => representatives.find(r => r.id === id)?.name || id).join(', ')
                        : 'Select representatives'}
                </Select.Trigger>
                <Select.Content>
                    <Select.Group>
                        <Select.GroupHeading>Representatives</Select.GroupHeading>
                        {#each representatives as rep}
                            <Select.Item 
                                value={rep.id}
                                onclick={() => handleRepresentativeChange(rep.id)}
                            >
                                {rep.name}
                            </Select.Item>
                        {/each}
                    </Select.Group>
                </Select.Content>
            </Select.Root>
        </div>
        <div class="flex justify-end space-x-2">
            <Button variant="outline" onclick={() => showShareDialog = false}>
                Cancel
            </Button>
            <Button onclick={handleShare}>
                Share
            </Button>
        </div>
    </DialogContent>
</Dialog> 