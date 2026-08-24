<script lang="ts">
    import { onMount } from 'svelte';
    import { run, preventDefault } from 'svelte/legacy';

    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { enhance } from "$app/forms";
    import { toast } from "svelte-sonner";
    import { page } from '$app/stores';
    import { invalidateAll } from "$app/navigation";
    import { Upload, Link2, Archive, RotateCcw, Trash2, Loader2, ArrowLeft, Bot, Globe, FileText, Save } from 'lucide-svelte';
    import * as Tabs from "$lib/components/ui/tabs";
    import * as Dialog from "$lib/components/ui/dialog";

    let { data } = $props();
    const { viewrooms } = data;
    let aiAssistant = $derived(data.aiAssistant);
    let trainingFilesResolved = $derived(data.trainingFilesResolved || []);
    let allTrainingFiles = $derived(data.allTrainingFiles || []);

    function formatFileType(type: string): string {
        if (!type) return '—';
        if (type.includes('pdf')) return 'PDF';
        if (type.includes('wordprocessingml') || type.includes('msword')) return 'DOCX';
        return type.split('/').pop()?.toUpperCase() ?? type;
    }

    function formatDate(date: string | Date) {
        return new Date(date).toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric'
        });
    }

    let fileInput = $state<HTMLInputElement | undefined>();
    let uploading = $state(false);

    /** Always string[] (viewroom IDs). Normalize from expanded PB relation or raw array. */
    let selectedViewrooms: string[] = $state([]);
    let selectedTrainingFiles: string[] = $state([]);
    let assistantName = $state('');
    let systemPrompt = $state('');
    let isSaving = $state(false);
    let fileToDelete = $state<string | null>(null);
    let isDeletingFile = $state(false);

    $effect(() => {
        selectedViewrooms = normalizeViewroomIds(aiAssistant.viewroomConnections);
        selectedTrainingFiles = [...(aiAssistant.trainingFiles || [])];
        assistantName = aiAssistant.name || '';
        systemPrompt = aiAssistant.systemPrompt || '';
    });

    function normalizeViewroomIds(conn: unknown): string[] {
        if (!conn || !Array.isArray(conn)) return [];
        return conn.map((c) => (typeof c === 'string' ? c : (c as { id: string })?.id)).filter(Boolean);
    }

    function handleFileUpload() {
        if (fileInput?.files?.length) {
            (async () => {
                uploading = true;
                try {
                    for (const file of fileInput?.files ?? []) {
                        await submitFileUpload(file);
                    }
                } finally {
                    uploading = false;
                }
            })();
        }
    }
    
    async function submitFileUpload(file: File) {
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(`/api/ai-assistants/${aiAssistant.id}/upload-training-file`, {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                toast.success('File uploaded successfully');
                await invalidateAll();
            } else {
                toast.error(result.message || 'Failed to upload file');
            }
        } catch (err) {
            console.error('Error uploading file:', err);
            toast.error('Failed to upload file');
        } finally {
            await invalidateAll();
        }
    }

    async function saveChanges() {
        isSaving = true;
        try {
            const formData = new FormData();
            formData.append('name', assistantName);
            formData.append('systemPrompt', systemPrompt);
            
            // Ensure viewroomConnections is always sent, even if empty
            formData.append('viewroomConnections', ''); 
            selectedViewrooms.filter(Boolean).forEach(id => formData.append('viewroomConnections', id));
            
            // Ensure trainingFileIds is sent, even if empty
            formData.append('trainingFileIds', '');
            selectedTrainingFiles.filter(Boolean).forEach(id => formData.append('trainingFileIds', id));
            
            const response = await fetch(`/api/ai-assistants/${aiAssistant.id}`, {
                method: 'PUT',
                body: formData
            });
            const result = await response.json();
            if (result.success) {
                toast.success('Settings saved successfully');
                invalidateAll();
            } else {
                toast.error(result.message || 'Failed to save settings');
            }
        } catch (e) {
            console.error(e);
            toast.error('Failed to save settings');
        } finally {
            isSaving = false;
        }
    }

    async function confirmDeleteFile() {
        if (!fileToDelete) return;
        isDeletingFile = true;
        
        try {
            const formData = new FormData();
            formData.append('fileId', fileToDelete);
            
            const response = await fetch(`/ai-assistants/${aiAssistant.id}?/deleteFile`, {
                method: 'POST',
                body: formData
            });
            
            let result;
            try {
                result = JSON.parse(await response.text());
            } catch (e) {
                // Ignore parse errors, just assume failure if not handled
            }

            if (result?.type === 'success') {
                toast.success('File deleted completely');
                selectedTrainingFiles = selectedTrainingFiles.filter(id => id !== fileToDelete);
                fileToDelete = null;
                invalidateAll();
            } else {
                toast.error(result?.data?.message || 'Failed to delete file');
            }
        } catch (error) {
            console.error('Error deleting file:', error);
            toast.error('Failed to delete file');
        } finally {
            isDeletingFile = false;
        }
    }
</script>

<div class="flex h-screen bg-[#eceef3]">
    <div class="flex-1 overflow-auto p-4 sm:p-6 mt-[6rem]">
        <div class="mx-auto max-w-5xl space-y-6 pb-20">
            <!-- Header -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div class="flex items-center gap-4">
                    <a href="/ai-assistants" class="p-2 hover:bg-gray-200 rounded-full transition-colors">
                        <ArrowLeft class="h-6 w-6 text-slate-600" />
                    </a>
                    <div>
                        <h1 class="text-[28px] font-bold text-slate-800 font-['Poppins']">Assistant Settings</h1>
                        <p class="text-sm text-slate-500 font-['Poppins']">Configure your AI knowledge and behavior</p>
                    </div>
                </div>
                <Button 
                    class="bg-[#577AB7] hover:bg-[#466699] text-white flex items-center gap-2 rounded-md"
                    onclick={saveChanges}
                    disabled={isSaving}
                >
                    {#if isSaving}
                        <Loader2 class="h-4 w-4 animate-spin" />
                    {:else}
                        <Save class="h-4 w-4" />
                    {/if}
                    Save Changes
                </Button>
            </div>

            <!-- Basic Configuration Panel -->
            <div class="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
                <div class="flex items-center gap-2 mb-6">
                    <Bot class="h-5 w-5 text-[#577AB7]" />
                    <h2 class="text-lg font-bold text-slate-800 font-['Poppins']">Basic Configuration</h2>
                </div>
                
                <div class="space-y-4">
                    <div>
                        <Label class="text-sm text-slate-600 mb-1.5 block">Assistant Name</Label>
                        <Input 
                            bind:value={assistantName}
                            class="w-full text-slate-800 font-['Poppins'] border-gray-200 focus:border-[#577AB7] focus:ring-[#577AB7]" 
                            placeholder="e.g. AI Visualizer"
                        />
                    </div>
                    
                    <div>
                        <Label class="text-sm text-slate-600 mb-1.5 block">System Prompt (Instructions)</Label>
                        <textarea 
                            bind:value={systemPrompt}
                            class="w-full min-h-[120px] p-3 text-sm text-slate-800 font-['Poppins'] border border-gray-200 rounded-md focus:border-[#577AB7] focus:ring-[#577AB7] resize-y" 
                            placeholder="Tell AI how it will respond"
                        ></textarea>
                        <div class="flex items-center gap-1.5 mt-2">
                            <span class="text-xs text-slate-400 font-['Poppins'] flex items-center gap-1">
                                <span class="flex items-center justify-center border border-slate-400 rounded-full w-3.5 h-3.5 text-[9px]">i</span>
                                This prompt defines the persona and basic behavior of your AI.
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ViewRoom Connections Panel -->
            <div class="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
                <div class="flex items-center gap-2 mb-2">
                    <Globe class="h-5 w-5 text-[#577AB7]" />
                    <h2 class="text-lg font-bold text-slate-800 font-['Poppins']">ViewRoom Connections</h2>
                </div>
                <p class="text-sm text-slate-500 font-['Poppins'] mb-6 leading-relaxed">
                    Same ViewRooms as on /viewroom. When someone uses AI chat inside a ViewRoom, the server picks an assistant whose connections include that room's title. Each ViewRoom can only be linked to one knowledge base at a time.
                </p>
                
                <div class="space-y-3">
                    {#each viewrooms as viewroom}
                        <label class="flex items-center gap-3 p-3 border border-gray-100 rounded-md hover:bg-gray-50 cursor-pointer transition-colors max-w-xl">
                            <input 
                                type="checkbox"
                                value={viewroom.id}
                                class="w-4 h-4 text-[#577AB7] border-gray-300 rounded focus:ring-[#577AB7]"
                                checked={selectedViewrooms.includes(viewroom.id)}
                                onchange={(e) => {
                                    if (e.currentTarget.checked) {
                                        selectedViewrooms = [...selectedViewrooms, viewroom.id];
                                    } else {
                                        selectedViewrooms = selectedViewrooms.filter(id => id !== viewroom.id);
                                    }
                                }}
                            />
                            <span class="text-sm text-slate-800 font-medium font-['Poppins']">{viewroom.title}</span>
                        </label>
                    {/each}
                    {#if viewrooms.length === 0}
                        <div class="text-sm text-slate-500 italic">No ViewRooms available in this company.</div>
                    {/if}
                </div>
            </div>

            <!-- Knowledge Base Panel -->
            <div class="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
                <div class="flex items-center gap-2 mb-2">
                    <FileText class="h-5 w-5 text-[#577AB7]" />
                    <h2 class="text-lg font-bold text-slate-800 font-['Poppins']">Knowledge Base (Training Files)</h2>
                </div>
                <p class="text-sm text-slate-500 font-['Poppins'] mb-6 leading-relaxed">
                    Upload a PDF or Word file here (no need to open the content library dashboard), or select documents you already have in the library. You can also attach PDFs when editing a ViewRoom on /viewroom; those files appear below once they exist in your library.
                </p>
                
                <input 
                    type="file" 
                    class="hidden" 
                    bind:this={fileInput}
                    onchange={handleFileUpload}
                    multiple
                    accept=".pdf,.docx,.doc"
                    disabled={uploading}
                />
                
                <Button 
                    variant="outline"
                    class="mb-6 flex items-center gap-2 text-slate-700 border-gray-300"
                    onclick={() => !uploading && fileInput?.click()}
                    disabled={uploading}
                >
                    {#if uploading}
                        <Loader2 class="h-4 w-4 animate-spin text-[#577AB7]" />
                        Uploading...
                    {:else}
                        <Upload class="h-4 w-4 text-[#577AB7]" />
                        Upload PDF or Word
                    {/if}
                </Button>

                <div class="space-y-3 border-t border-gray-100 pt-6">
                    {#if allTrainingFiles && allTrainingFiles.length > 0}
                        {#each allTrainingFiles as file, index}
                            <div class="flex items-center gap-3 p-3 border border-gray-100 rounded-md hover:bg-gray-50 transition-colors w-full group relative">
                                <label class="flex-1 flex items-center gap-3 cursor-pointer">
                                    <input 
                                        type="checkbox"
                                        value={file.id}
                                        class="w-4 h-4 text-[#577AB7] border-gray-300 rounded focus:ring-[#577AB7] mt-0.5"
                                        checked={selectedTrainingFiles.includes(file.id)}
                                        onchange={(e) => {
                                            if (e.currentTarget.checked) {
                                                selectedTrainingFiles = [...selectedTrainingFiles, file.id];
                                            } else {
                                                selectedTrainingFiles = selectedTrainingFiles.filter(id => id !== file.id);
                                            }
                                        }}
                                    />
                                    <div class="flex-1 flex justify-between items-center pr-2">
                                        <div>
                                            <div class="text-sm text-slate-800 font-medium font-['Poppins']">{file.title}</div>
                                            <div class="text-[11px] text-slate-500 font-semibold mt-0.5">{formatFileType(file.type)}</div>
                                        </div>
                                        {#if selectedTrainingFiles.includes(file.id)}
                                            <span class="text-[10px] font-semibold text-[#577AB7] uppercase tracking-wider bg-blue-50 px-2 py-1 rounded-sm">Attached</span>
                                        {/if}
                                    </div>
                                </label>
                                <button 
                                    type="button"
                                    class="ml-2 text-red-400 hover:text-red-600 p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Delete file permanently"
                                    onclick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        fileToDelete = file.id;
                                    }}
                                >
                                    <Trash2 class="h-4 w-4" />
                                </button>
                            </div>
                        {/each}
                    {:else}
                        <div class="p-6 text-center text-sm text-slate-500 italic border border-gray-100 rounded-md">
                            No training files uploaded. Upload a file above to add to your company library.
                        </div>
                    {/if}
                </div>
            </div>
            
        </div>
    </div>
</div>

<Dialog.Root open={!!fileToDelete} onOpenChange={(v) => { if (!v && !isDeletingFile) fileToDelete = null; }}>
    <Dialog.Content class="sm:max-w-[425px]">
        <Dialog.Header>
            <Dialog.Title>Delete Training File</Dialog.Title>
            <Dialog.Description>
                Are you sure you want to permanently delete this file? It will be removed from your company's knowledge base and detached from any AI assistants using it. This action cannot be undone.
            </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer class="mt-6 flex justify-end gap-2">
            <Button 
                variant="outline" 
                onclick={() => fileToDelete = null}
                disabled={isDeletingFile}
            >
                Cancel
            </Button>
            <Button 
                variant="destructive" 
                onclick={confirmDeleteFile}
                disabled={isDeletingFile}
            >
                {#if isDeletingFile}
                    <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                    Deleting...
                {:else}
                    Delete File
                {/if}
            </Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>