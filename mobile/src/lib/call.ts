/** Calls the API as the signed-in person, with their session token (see useAuth). */
export type Call = <T>(request: (token: string) => Promise<T>) => Promise<T>;
