// Synthetic boundary. Tests never execute this module during static analysis.
export const db = { subscription: { update: (_value: unknown) => { throw new Error('real DB must not run'); } } };
