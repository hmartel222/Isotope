/** A fail-closed specimen boundary. There is no database client or connection. */
export const db = {
  subscription: {
    async update(_args: unknown): Promise<unknown> {
      throw new Error('The specimen DB boundary must be mocked by Isotope');
    },
  },
};
