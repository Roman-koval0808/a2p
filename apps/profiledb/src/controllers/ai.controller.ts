import { Request, Response } from 'express';

export async function explainDecision(req: Request, res: Response) {
  try {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return res.status(503).json({
        error: "OpenAI is not configured on the database server.",
      });
    }

    const { system, messages } = req.body;

    const openaiMessages = [
      { role: 'system', content: system },
      ...(messages || []).map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: openaiMessages,
        temperature: 0.6,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[postAiChat] OpenAI error:", response.status, errText);
      return res.status(502).json({ error: "OpenAI returned an error.", details: errText });
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content?.trim() || '';

    return res.status(200).json({ content });
  } catch (error: any) {
    console.error("AI controller error:", error);
    return res.status(500).json({ error: "Internal server error", details: error.message });
  }
}
