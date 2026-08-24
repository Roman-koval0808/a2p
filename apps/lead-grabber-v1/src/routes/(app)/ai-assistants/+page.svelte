<!-- Ported from the standalone viewroom app. Two adaptations: a2p's (app) layout already
     renders the sidebar, so the viewroom's <Sidenav> is dropped; and the record fields are
     camelCase Prisma columns (trainingFiles, viewroomConnections, systemPrompt) rather than
     the viewroom's snake_case PocketBase fields. -->
<script lang="ts">
    import { stopPropagation, preventDefault } from 'svelte/legacy';

    import { Button } from "$lib/components/ui/button";
    import { MoreHorizontal, Upload, Link2, Eye, Archive, Trash2, Plus, Bot, FileText, Clock, Edit } from 'lucide-svelte';
    import * as Dialog from "$lib/components/ui/dialog";
    import { Label } from "$lib/components/ui/label";
    import { Input } from "$lib/components/ui/input";
    import { enhance } from "$app/forms";
    import * as Tabs from "$lib/components/ui/tabs";
    import * as Select from "$lib/components/ui/select";
    import { toast } from "svelte-sonner";
    import { invalidateAll } from "$app/navigation";

    

    let showAddDialog = $state(false);
    let showViewroomDialog = $state(false);
    let showEngagementDialog = $state(false);
    let showDeleteDialog = $state(false);
    let dialogTitle = $state('');
    let contentToShow: any[] = $state([]);
    let newAssistantName = $state('');
    let selectedViewrooms = $state<string[]>([]);
    let selectedFiles: FileList | null = $state(null);
    let selectedAiId = $state('');
    let selectedAiName = $state('');
    let activeMenuId = $state('');
    let viewroomDropdownOpen = $state(false);
    
    function formatDate(date: string | Date) {
        return new Date(date).toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: '2-digit'
        });
    }

    function toggleMenu(aiId: string) {
        if (activeMenuId === aiId) {
            activeMenuId = '';
        } else {
            activeMenuId = aiId;
        }
    }

    // Close menu when clicking outside
    function handleWindowClick(event: MouseEvent) {
        if (activeMenuId && !(event.target as HTMLElement).closest('.menu-trigger, .menu-content')) {
            activeMenuId = '';
        }
        if (viewroomDropdownOpen && !(event.target as HTMLElement).closest('.viewroom-dropdown')) {
            viewroomDropdownOpen = false;
        }
    }

    // Add event listener when the component mounts
    import { onMount } from 'svelte';
    let { data } = $props();
    onMount(() => {
        window.addEventListener('click', handleWindowClick);
        return () => {
            window.removeEventListener('click', handleWindowClick);
        };
    });

    function showViewroomConnections(ai: any) {
        selectedAiId = ai.id;
        selectedAiName = ai.name;
        const connections = ai.viewroomConnections || [];
        
        if (connections.length > 0) {
            contentToShow = connections
                .map((id: any) => ({ 
                    id, 
                    title: data.viewrooms.find((v: any) => v.id === id)?.title || 'Unknown Viewroom'
                }));
        } else {
            contentToShow = [];
        }
        
        dialogTitle = "Viewroom Connections";
        showViewroomDialog = true;
    }
    
    function showEngagements(ai: any) {
        selectedAiId = ai.id;
        selectedAiName = ai.name;
        const engagements = typeof ai.engagements === 'string' 
            ? JSON.parse(ai.engagements) 
            : ai.engagements || [];
            
        contentToShow = engagements;
        dialogTitle = "Engagement History";
        showEngagementDialog = true;
    }
    
    function showDeleteConfirmation(ai: any) {
        selectedAiId = ai.id;
        selectedAiName = ai.name;
        showDeleteDialog = true;
        activeMenuId = '';
    }

    function handleViewroomSelect(event: CustomEvent<{ value: string }[]>) {
        selectedViewrooms = event.detail.map((item: any) => item.value);
    }

    function handleFileChange(event: any) {
        selectedFiles = event.target.files;
    }

    // NOTE: the viewroom's handleSubmit() posted to a `?/create` form action and was removed here —
    // it was never bound to a form, and this page creates assistants via POST /api/ai-assistants.
    // Use data from the server
    let aiAssistants = $derived(data.aiAssistants || []);
</script>

<div class="flex h-screen bg-[#eceef3]">
    
    <div class="flex-1 overflow-auto p-4 sm:p-6 mt-[6rem]">
        <div class="mx-auto space-y-6 max-w-7xl">
            <!-- Header -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 class="text-[28px] font-bold text-slate-800 font-['Poppins']">AI Assistants</h1>
                    <p class="text-sm text-slate-500 font-['Poppins']">Manage AI knowledge base for your ViewRooms</p>
                </div>
                <Button 
                    class="bg-[#577AB7] hover:bg-[#466699] text-white flex items-center gap-2 rounded-md"
                    onclick={() => showAddDialog = true}
                >
                    <Plus class="h-4 w-4" />
                    Create Assistant
                </Button>
            </div>

            <!-- Cards Grid -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {#each aiAssistants as ai}
                    <div class="bg-white rounded-lg p-5 shadow-sm border border-gray-100 flex flex-col h-full">
                        <div class="flex justify-between items-start mb-4">
                            <h3 class="text-[17px] font-semibold text-[#577AB7] font-['Poppins']">{ai.name}</h3>
                            <Bot class="h-5 w-5 text-[#577AB7]" />
                        </div>
                        
                        <div class="space-y-3 mb-6 flex-grow">
                            <div class="flex items-center gap-2 text-[14px] text-slate-500 font-['Poppins']">
                                <Link2 class="h-4 w-4" />
                                <span>{Array.isArray(ai.viewroomConnections) ? ai.viewroomConnections.length : (typeof ai.viewroomConnections === 'string' ? JSON.parse(ai.viewroomConnections || '[]').length : 0)} ViewRooms connected</span>
                            </div>
                            <div class="flex items-center gap-2 text-[14px] text-slate-500 font-['Poppins']">
                                <FileText class="h-4 w-4" />
                                <span>{Array.isArray(ai.trainingFiles) ? ai.trainingFiles.length : (typeof ai.trainingFiles === 'string' ? JSON.parse(ai.trainingFiles || '[]').length : 0)} Training files</span>
                            </div>
                            <div class="flex items-center gap-2 text-[14px] text-slate-500 font-['Poppins']">
                                <Clock class="h-4 w-4" />
                                <span>Created {formatDate(ai.created)}</span>
                            </div>
                        </div>

                        <div class="flex gap-2 mt-auto">
                            <a 
                                href={`/ai-assistants/${ai.id}`}
                                class="flex-1 bg-[#577AB7] hover:bg-[#466699] text-white text-sm font-medium py-2 px-4 rounded-[4px] flex items-center justify-center gap-2 transition-colors font-['Poppins']"
                            >
                                <Edit class="h-4 w-4" />
                                Knowledge Base
                            </a>
                            <button 
                                class="bg-red-50 hover:bg-red-100 text-red-500 p-2 rounded-[4px] flex items-center justify-center transition-colors border border-red-100"
                                onclick={() => showDeleteConfirmation(ai)}
                            >
                                <Trash2 class="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    </div>
</div>

<!-- Add AI Assistant Dialog -->
<Dialog.Root bind:open={showAddDialog}>
    <Dialog.Content class="max-w-md bg-white rounded-lg p-5 shadow-lg">
        <form
            method="POST"
            onsubmit={preventDefault(async (e) => {
                const form = e.target;
                if (!(form instanceof HTMLFormElement)) return;
                const formData = new FormData(form);
                formData.getAll('viewroomConnections').forEach(() => formData.delete('viewroomConnections'));
                [...new Set(selectedViewrooms)].filter(Boolean).forEach((id) => formData.append('viewroomConnections', id));
                try {
                    const response = await fetch('/api/ai-assistants', { method: 'POST', body: formData });
                    const result = await response.json();
                    if (result.success) {
                        showAddDialog = false;
                        newAssistantName = '';
                        selectedViewrooms = [];
                        selectedFiles = null;
                        const fileInput = form.querySelector('input[name="trainingFiles"]');
                        if (fileInput && fileInput instanceof HTMLInputElement) fileInput.value = '';
                        toast.success('AI assistant created successfully');
                    } else {
                        toast.error(result.message || 'Failed to create AI assistant');
                    }
                } catch (error) {
                    console.error('Error:', error);
                    toast.error('Failed to create AI assistant');
                } finally {
                    await invalidateAll();
                }
            })}
            enctype="multipart/form-data"
        >
            <div class="space-y-4">
                <h2 class="text-lg font-semibold text-[#808080]">Add New AI Assistant</h2>
                
                <div class="space-y-1">
                    <div class="text-sm text-[#808080]">Assistant Name</div>
                    <input 
                        id="assistantName"
                        name="name"
                        value={newAssistantName}
                        placeholder="Enter assistant name"
                        class="w-full border border-gray-300 px-3 py-1.5 rounded text-sm"
                        required
                    />
                </div>
                
                <div class="space-y-1">
                    <div class="text-sm text-[#808080]">ViewRoom Connection (Optional)</div>
                    <div class="relative w-full viewroom-dropdown">
                        <button 
                            type="button" 
                            class="w-full flex justify-between items-center border border-gray-300 px-3 py-1.5 rounded text-sm bg-white"
                            onclick={() => viewroomDropdownOpen = !viewroomDropdownOpen}
                        >
                            <div class="w-full flex justify-between items-center">
                                {#if selectedViewrooms.length > 0}
                                    <span class="truncate flex items-center gap-1 flex-wrap">
                                        {#each selectedViewrooms.slice(0, 6) as viewroomId, i}
                                            <span class="inline-flex items-center gap-1">
                                                <Link2 class="h-3 w-3" />
                                                {data.viewrooms.find((v: any) => v.id === viewroomId)?.title || viewroomId}
                                                {i < Math.min(selectedViewrooms.slice(0, 6).length - 1, 5) ? ', ' : ''}
                                            </span>
                                        {/each}
                                        {#if selectedViewrooms.length > 6}
                                            <span class="text-muted-foreground">...</span>
                                        {/if}
                                    </span>
                                {:else}
                                    <span class="text-muted-foreground">Select ViewRoom(s)...</span>
                                {/if}
                            </div>
                        </button>
                        
                        {#if viewroomDropdownOpen}
                            <div class="absolute left-0 w-full mt-1 bg-[#ECEFF3] p-4 rounded-md shadow-lg max-h-[225px] overflow-y-auto z-50">
                                {#each data.viewrooms || [] as viewroom}
                                    <div class="flex items-center justify-between gap-3 mb-3">
                                        <div class="flex items-center gap-2">
                                            <Link2 class="h-4 w-4 text-[#577AB7]" />
                                            <span class="font-[Poppins] text-[16px] leading-[118%] text-[#808080]">
                                                {viewroom.title}
                                            </span>
                                        </div>
                                        <div class="relative">
                                            <input 
                                                type="checkbox" 
                                                id="viewroom_{viewroom.id}" 
                                                value={viewroom.id}
                                                class="hidden peer"
                                                onchange={(e) => {
                                                    const checkbox = e.currentTarget;
                                                    if (checkbox.checked) {
                                                        selectedViewrooms = [...selectedViewrooms, viewroom.id];
                                                    } else {
                                                        selectedViewrooms = selectedViewrooms.filter((id: any) => id !== viewroom.id);
                                                    }
                                                }}
                                                checked={selectedViewrooms.includes(viewroom.id)}
                                            />
                                            <label 
                                                for="viewroom_{viewroom.id}" 
                                                class="box-border w-[23px] h-[22px] bg-white border-2 border-[#808080] rounded-[2px] inline-block cursor-pointer peer-checked:bg-[#66A73B] peer-checked:border-[#66A73B] relative"
                                            >
                                                {#if selectedViewrooms.includes(viewroom.id)}
                                                    <svg class="absolute inset-0 w-full h-full text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                        <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" fill="white"/>
                                                    </svg>
                                                {/if}
                                            </label>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>
                
                <div class="space-y-1">
                    <div class="text-sm text-[#808080]">Training Files (Optional)</div>
                    <div class="flex items-center justify-center w-full">
                        <label 
                            for="trainingFiles"
                            class="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 border-gray-300"
                        >
                            <div class="flex flex-col items-center justify-center pt-5 pb-6">
                                <Upload class="w-8 h-8 mb-3 text-gray-400" />
                                <p class="mb-2 text-sm text-gray-500"><span class="font-semibold">Click to upload</span> or drag and drop</p>
                                <p class="text-xs text-gray-500">PDF or Word documents</p>
                            </div>
                            <input 
                                id="trainingFiles" 
                                name="trainingFiles" 
                                type="file" 
                                class="hidden"
                                multiple
                                accept=".pdf,.docx,.doc"
                                onchange={handleFileChange}
                            />
                        </label>
                    </div>
                    {#if selectedFiles && selectedFiles.length > 0}
                        <div class="text-sm text-gray-600">
                            Selected {selectedFiles.length} file(s)
                        </div>
                    {/if}
                </div>
                
                <div class="flex justify-end pt-1">
                    <button 
                        type="button"
                        class="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-1 text-sm rounded mr-2"
                        onclick={() => showAddDialog = false}
                    >
                        Cancel
                    </button>
                    <button 
                        type="submit"
                        class="bg-[#C2D1E8] hover:bg-[#A4B8D9] text-[#000000] px-4 py-1 text-sm rounded"
                    >
                        Add
                    </button>
                </div>
            </div>
        </form>
    </Dialog.Content>
</Dialog.Root>

<!-- Viewroom Connections Dialog -->
<Dialog.Root bind:open={showViewroomDialog}>
    <Dialog.Content class="max-w-md bg-white rounded-lg p-5 shadow-lg">
        <Dialog.Header>
            <Dialog.Title>{dialogTitle} - {selectedAiName}</Dialog.Title>
        </Dialog.Header>
        <div class="py-4">
            <div class="space-y-4">
                {#if contentToShow.length > 0}
                    {#each contentToShow as viewroom}
                        <div class="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                            <Link2 class="h-5 w-5 text-blue-500" />
                            <div class="flex-1">
                                <h3 class="font-medium text-md text-[#808080]">{viewroom.title}</h3>
                            </div>
                        </div>
                    {/each}
                {:else}
                    <div class="text-center text-gray-500 py-4">
                        No viewroom connections found
                    </div>
                {/if}
            </div>
        </div>
        <Dialog.Footer>
            <Button variant="outline" onclick={() => showViewroomDialog = false}>
                Close
            </Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>

<!-- Engagements Dialog -->
<Dialog.Root bind:open={showEngagementDialog}>
    <Dialog.Content class="max-w-lg bg-white rounded-lg p-5 shadow-lg">
        <Dialog.Header>
            <Dialog.Title>{dialogTitle} - {selectedAiName}</Dialog.Title>
        </Dialog.Header>
        <div class="py-4">
            <div class="space-y-4">
                {#if contentToShow.length > 0}
                    {#each contentToShow as engagement}
                        <div class="p-4 bg-gray-50 rounded-lg">
                            <div class="flex justify-between mb-2">
                                <div class="font-medium text-[#737373]">
                                    {formatDate(engagement.date)}
                                </div>
                                <div class="text-sm text-gray-500">
                                    {engagement.interaction_count || 0} interactions
                                </div>
                            </div>
                            <div class="bg-white p-3 rounded border border-gray-200">
                                <p class="text-[#808080]">{engagement.first_prompt || 'No prompt recorded'}</p>
                            </div>
                        </div>
                    {/each}
                {:else}
                    <div class="text-center text-gray-500 py-4">
                        No engagement history found
                    </div>
                {/if}
            </div>
        </div>
        <Dialog.Footer>
            <Button variant="outline" onclick={() => showEngagementDialog = false}>
                Close
            </Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>

<!-- Delete Confirmation Dialog -->
<Dialog.Root bind:open={showDeleteDialog}>
    <Dialog.Content class="max-w-md bg-white rounded-lg p-5 shadow-lg">
        <form
            method="POST"
            onsubmit={preventDefault(async (e) => {
                const formData = new FormData(e.target as HTMLFormElement);
                
                try {
                    const response = await fetch(`/api/ai-assistants/${selectedAiId}`, {
                        method: 'DELETE',
                        body: formData
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        showDeleteDialog = false;
                        toast.success('AI assistant deleted successfully');
                    } else {
                        toast.error(result.message || 'Failed to delete AI assistant');
                    }
                } catch (error) {
                    console.error('Error deleting:', error);
                    toast.error('Failed to delete AI assistant');
                } finally {
                    await invalidateAll();
                }
            })}
        >
            <div class="space-y-4">
                <h2 class="text-lg font-semibold text-red-500">Delete AI Assistant</h2>
                <p class="text-gray-700">
                    Are you sure you want to permanently delete "{selectedAiName}"? This action cannot be undone.
                </p>
                
                <input type="hidden" name="id" value={selectedAiId} />
                
                <div class="flex justify-end pt-4">
                    <Button 
                        type="button"
                        variant="outline"
                        class="mr-2"
                        onclick={() => showDeleteDialog = false}
                    >
                        Cancel
                    </Button>
                    <Button 
                        type="submit"
                        variant="destructive"
                        class="bg-red-500 hover:bg-red-600 text-white"
                    >
                        <Trash2 class="h-4 w-4 mr-2" />
                        Delete
                    </Button>
                </div>
            </div>
        </form>
    </Dialog.Content>
</Dialog.Root>