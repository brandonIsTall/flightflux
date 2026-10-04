/**
 * The global fetch, wrapped. workerd throws "Illegal invocation" when fetch is stored on an object
 * and called as a method (this.fetchFn(...)), so clients default to this instead of `fetch`.
 */
export const globalFetch: typeof fetch = (input, init) => fetch(input, init);
