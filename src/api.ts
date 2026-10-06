export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
 const response = await fetch(path, { method, headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
 const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Request failed.'); return result;
}
