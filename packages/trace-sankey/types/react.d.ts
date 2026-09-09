import * as React from 'react';
import { Channel, MountInstance, TraceModelOk } from './index';

export interface TraceSankeyProps {
  /** 追查 JSON（契約見 README）。換一個「內容相同的新物件」不會重畫、縮放保留。 */
  doc: unknown;
  /** 顯示門檻（bps），預設 0 */
  minBps?: number;
  /** storage 資料只看其中一個通道，預設 'both' */
  channels?: 'both' | Channel;
  /** 容器高度由這兩個決定，元件不設高度 */
  className?: string;
  style?: React.CSSProperties;
  onModel?: (model: TraceModelOk) => void;
  onError?: (errors: string[]) => void;
  onZoom?: (screenScale: number | null) => void;
}

/** ref 拿到的控制介面（轉呼叫 MountInstance） */
export type TraceSankeyHandle = Pick<MountInstance, 'update' | 'setMinBps' | 'setChannels' | 'refresh' | 'model'> & {
  zoom: Pick<MountInstance['zoom'], 'fit' | 'actual' | 'zoomBy' | 'refresh' | 'isPanning'>;
};

export const TraceSankey: React.ForwardRefExoticComponent<
  TraceSankeyProps & React.RefAttributes<TraceSankeyHandle>
>;
