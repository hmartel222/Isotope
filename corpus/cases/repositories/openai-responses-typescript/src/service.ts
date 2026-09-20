import { answer } from './openai-client';
import { store } from './store';
export async function process(prompt: string) { const text = await answer(prompt); return store.save({ text }); }
