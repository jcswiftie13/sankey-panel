/* React 薄殼：包一層 mount()，核心完全不知道 React 的存在。
   刻意不用 JSX（只有一個 createElement），套件才不需要任何 build step。
   react 是 optional peerDependency——只有走 'trace-sankey/react' 子路徑才會載到這支。 */
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { CSSProperties, ForwardRefExoticComponent, RefAttributes } from 'react';
import { mount } from './mount.js';
import type { MountInstance } from './mount.js';
import type { Channel, TraceModelOk } from './types.js';

export interface TraceSankeyProps {
  /** 追查 JSON（契約見 README）。換一個「內容相同的新物件」不會重畫、縮放保留。 */
  doc: unknown;
  /** 顯示門檻（bps），預設 0 */
  minBps?: number;
  /** storage 資料只看其中一個通道，預設 'both' */
  channels?: 'both' | Channel;
  /** 容器高度由這兩個決定，元件不設高度 */
  className?: string;
  style?: CSSProperties;
  onModel?: (model: TraceModelOk) => void;
  onError?: (errors: string[]) => void;
  onZoom?: (screenScale: number | null) => void;
}

/** ref 拿到的控制介面（轉呼叫 MountInstance） */
export type TraceSankeyHandle = Pick<MountInstance, 'update' | 'setMinBps' | 'setChannels' | 'refresh' | 'model'> & {
  zoom: Pick<MountInstance['zoom'], 'fit' | 'actual' | 'zoomBy' | 'refresh' | 'isPanning'>;
};

/* props：
     doc        追查 JSON（必填）
     minBps     顯示門檻（bps），預設 0
     channels   'both'（預設）／'read'／'write'，只看 storage 資料的其中一個通道
     className / style   直接放到容器 div 上；容器高度由這裡決定，元件不設高度
     onModel / onError / onZoom   轉交 mount()，永遠呼叫到最新的一份（存 ref，
                callback identity 變了不會觸發重新掛載）
   ref：拿到轉發 MountInstance 的控制介面（update / setMinBps / refresh / zoom.*）。 */
export var TraceSankey: ForwardRefExoticComponent<TraceSankeyProps & RefAttributes<TraceSankeyHandle>> =
  forwardRef<TraceSankeyHandle, TraceSankeyProps>(function TraceSankey(props, ref) {
  var elRef = useRef<HTMLDivElement | null>(null);
  var instRef = useRef<MountInstance | null>(null);
  var latest = useRef<TraceSankeyProps>(props);
  latest.current = props;

  /* 掛載一次、卸載時 destroy（destroy 冪等，StrictMode 的雙重掛載安全） */
  useEffect(function () {
    var inst = mount(elRef.current, latest.current.doc, {
      minBps: latest.current.minBps || 0,
      channels: latest.current.channels || 'both',
      onModel: function (m) { if (latest.current.onModel) latest.current.onModel(m); },
      onError: function (e) { if (latest.current.onError) latest.current.onError(e); },
      onZoom: function (s) { if (latest.current.onZoom) latest.current.onZoom(s); }
    });
    instRef.current = inst;
    return function () { inst.destroy(); instRef.current = null; };
  }, []);

  /* 資料、門檻或通道變了才 update；mount 內部的 key 比對讓「同內容的新物件」不重畫、縮放不被洗掉 */
  useEffect(function () {
    if (instRef.current) {
      instRef.current.update(props.doc, { minBps: props.minBps || 0, channels: props.channels || 'both' });
    }
  }, [props.doc, props.minBps, props.channels]);

  /* useImperativeHandle 在 mount effect 之前跑，instRef 當下還是 null——
     所以回傳的是轉呼叫的殼，不是實例本身 */
  useImperativeHandle(ref, function () {
    function inst() { return instRef.current; }
    return {
      update: function (d?: unknown, o?: any) { return inst() ? inst().update(d, o) : null; },
      setMinBps: function (n: number) { return inst() ? inst().setMinBps(n) : null; },
      setChannels: function (c: 'both' | Channel) { return inst() ? inst().setChannels(c) : null; },
      refresh: function () { if (inst()) inst().refresh(); },
      get model() { return inst() ? inst().model : null; },
      zoom: {
        fit: function () { if (inst()) inst().zoom.fit(); },
        actual: function () { if (inst()) inst().zoom.actual(); },
        zoomBy: function (f: number) { if (inst()) inst().zoom.zoomBy(f); },
        refresh: function () { if (inst()) inst().zoom.refresh(); },
        isPanning: function () { return !!(inst() && inst().zoom.isPanning()); }
      }
    };
  }, []);

  return createElement('div', { ref: elRef, className: props.className, style: props.style });
});
