import OpenAI from 'openai';
const client = new OpenAI({ baseURL: 'https://api.x.ai/v1' });
export async function handler(req: any, res: any) {
  const response = await client.responses.create({ model: 'gpt-4o-mini', input: req.body.prompt });
  return res.status(200).json({ text: response.output_text });
}
