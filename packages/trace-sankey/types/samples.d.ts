import { WireGraph } from './index';

export interface TraceSample {
  key: string;
  name: string;
  desc: string;
  json: WireGraph;
}

export const list: TraceSample[];
export const byKey: Record<string, TraceSample>;
export const defaultKey: string;
