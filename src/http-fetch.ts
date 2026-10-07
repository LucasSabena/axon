// Injectable HTTP clients need the fetch call signature, not Bun runtime helpers.
export type HttpFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => ReturnType<typeof fetch>;
