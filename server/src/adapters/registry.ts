import type { WorkerSettings } from '../../../src/shared/settings';
import type { WorkerAdapter } from './types';
import { DshAdapter } from './dsh';

export class AdapterRegistry {
  private adapters = new Map<string, WorkerAdapter>();
  constructor(adapters: WorkerAdapter[]) { for (const adapter of adapters) this.adapters.set(adapter.id, adapter); }
  get(id: string): WorkerAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`未知执行 Agent: ${id}`);
    return adapter;
  }
  infos(settings: WorkerSettings) { return Promise.all([...this.adapters.values()].map(a => a.info(settings))); }
}
export const createRegistry = (home: string) => new AdapterRegistry([
  new DshAdapter(home),
]);
