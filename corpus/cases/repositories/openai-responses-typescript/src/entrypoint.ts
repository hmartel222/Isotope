import { process } from './service';
export async function handler(req: any, res: any) { const result = await process(req.body.prompt); return res.status(200).json(result); }
