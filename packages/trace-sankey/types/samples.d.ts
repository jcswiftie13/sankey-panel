import { TraceDoc } from './index';

export interface TraceSample {
  key: string;
  name: string;
  desc: string;
  json: TraceDoc;
}

export const list: TraceSample[];
export const byKey: Record<string, TraceSample>;
export const defaultKey: string;
