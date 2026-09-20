import OpenAI from 'openai';
const client = new OpenAI({ apiKey: 'controlled', baseURL: 'https://api.x.ai/v1' });
export async function answer(input: string) {
  const response = await client.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: input }] });
  return response.choices[0].message.content;
}
