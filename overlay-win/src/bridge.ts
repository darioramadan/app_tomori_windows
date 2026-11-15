// The Electron preload's API (electron/preload.cjs): invoke a main-process handler, or listen to an event it sends.
interface Api {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  on(event: string, cb: (payload: unknown) => void): void;
}
const api = (window as unknown as { tomari: Api }).tomari;

export const invoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => api.invoke(cmd, args) as Promise<T>;

export async function listen<T>(event: string, cb: (e: { payload: T }) => void): Promise<void> {
  api.on(event, (payload) => cb({ payload: payload as T }));
}
