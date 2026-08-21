export function parseMarkdown(text: string): string {
    if (!text) return '';
    
    // 1. Escape HTML to prevent XSS
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // 2. Code blocks (```code```)
    html = html.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, '<pre class="bg-gray-800/50 text-gray-200 p-2 rounded-md my-2 overflow-x-auto font-mono text-xs border border-[#47484B]"><code class="whitespace-pre-wrap">$1</code></pre>');
    
    // 3. Inline code (`code`)
    html = html.replace(/`([^`\n]+)`/g, '<code class="bg-gray-800/50 text-gray-200 px-1.5 py-0.5 rounded text-xs border border-[#47484B] font-mono">$1</code>');
    
    // 4. Bold (**text**)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold">$1</strong>');
    
    // 5. Italic (*text* or _text_)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
    
    // 6. Links ([text](url))
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 underline">$1</a>');
    
    // 7. Lists (- item or * item)
    html = html.replace(/^[ \t]*[-*][ \t]+(.+)$/gm, '<li class="ml-4 list-disc">$1</li>');
    // Group consecutive list items into ul
    html = html.replace(/(<li.*<\/li>\n?)+/g, '<ul class="my-2 space-y-1">$&</ul>');
    
    // 8. Numbered lists (1. item)
    html = html.replace(/^[ \t]*\d+\.[ \t]+(.+)$/gm, '<li class="ml-4 list-decimal">$1</li>');
    html = html.replace(/(<li class="ml-4 list-decimal".*<\/li>\n?)+/g, '<ol class="my-2 space-y-1">$&</ol>');

    // 9. New lines to <br> for non-list elements
    // We only replace \n with <br> if it's not immediately after a block element tag
    html = html.replace(/\n(?!(<\/ul>|<\/ol>|<\/li>|<\/pre>|<ul|<ol|<li|<pre))/g, '<br>');

    return html;
}
