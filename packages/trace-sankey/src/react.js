/* React 薄殼：包一層 mount()，核心完全不知道 React 的存在。
   刻意不用 JSX（只有一個 createElement），套件才不需要任何 build step。
   react 是 optional peerDependency——只有走 'trace-sankey/react' 子路徑才會載到這支。 */
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { mount } from './mount.js';

/* props：
     doc        追查 JSON（必填）
     minBps     顯示門檻（bps），預設 0
     channels   'both'（預設）／'read'／'write'，只看 storage 資料的其中一個通道
     layout     'flat'（預設）／'node'：k8s node 外框
     roots      參考面板的 root 選擇；沒給＝所有 no-flow 節點都保留
     pathHighlight   滑到卡片亮整條路徑（掛載時決定，之後改不重綁）
     className / style   直接放到容器 div 上；容器高度由這裡決定，元件不設高度
     onModel / onError / onZoom / onNodeClick   轉交 mount()，永遠呼叫到最新的一份（存 ref，
                callback identity 變了不會觸發重新掛載）
   ref：拿到轉發 MountInstance 的控制介面（update / setMinBps / setChannels / setLayout / setRoots /
        focus / refresh / zoom.*）。 */
export var TraceSankey = forwardRef(function TraceSankey(props, ref) {
  var elRef = useRef(null);
  var instRef = useRef(null);
  var latest = useRef(props);
  latest.current = props;

  /* 掛載一次、卸載時 destroy（destroy 冪等，StrictMode 的雙重掛載安全） */
  useEffect(function () {
    var inst = mount(elRef.current, latest.current.doc, {
      minBps: latest.current.minBps || 0,
      channels: latest.current.channels || 'both',
      layout: latest.current.layout || 'flat',
      roots: latest.current.roots || null,
      pathHighlight: !!latest.current.pathHighlight,
      onModel: function (m) { if (latest.current.onModel) latest.current.onModel(m); },
      onError: function (e) { if (latest.current.onError) latest.current.onError(e); },
      onZoom: function (s) { if (latest.current.onZoom) latest.current.onZoom(s); },
      /* 有沒有點擊回呼在掛載時決定（mount 靠它決定要不要把卡標成可點）；之後換 callback 仍呼叫到最新的 */
      onNodeClick: latest.current.onNodeClick
        ? function (id, n) { if (latest.current.onNodeClick) latest.current.onNodeClick(id, n); }
        : undefined
    });
    instRef.current = inst;
    return function () { inst.destroy(); instRef.current = null; };
  }, []);

  /* 資料或會改 model 的選項變了才 update；mount 內部的 key 比對讓「同內容的新物件」不重畫、縮放不被洗掉 */
  useEffect(function () {
    if (instRef.current) {
      instRef.current.update(props.doc, {
        minBps: props.minBps || 0, channels: props.channels || 'both',
        layout: props.layout || 'flat', roots: props.roots || null
      });
    }
  }, [props.doc, props.minBps, props.channels, props.layout, props.roots]);

  /* useImperativeHandle 在 mount effect 之前跑，instRef 當下還是 null——
     所以回傳的是轉呼叫的殼，不是實例本身 */
  useImperativeHandle(ref, function () {
    function inst() { return instRef.current; }
    return {
      update: function (d, o) { return inst() ? inst().update(d, o) : null; },
      setMinBps: function (n) { return inst() ? inst().setMinBps(n) : null; },
      setChannels: function (c) { return inst() ? inst().setChannels(c) : null; },
      setLayout: function (l) { return inst() ? inst().setLayout(l) : null; },
      setRoots: function (r) { return inst() ? inst().setRoots(r) : null; },
      focus: function (on) { if (inst()) inst().focus(on); },
      isFocused: function () { return !!(inst() && inst().isFocused()); },
      refresh: function () { if (inst()) inst().refresh(); },
      get model() { return inst() ? inst().model : null; },
      zoom: {
        fit: function () { if (inst()) inst().zoom.fit(); },
        actual: function () { if (inst()) inst().zoom.actual(); },
        zoomBy: function (f) { if (inst()) inst().zoom.zoomBy(f); },
        refresh: function () { if (inst()) inst().zoom.refresh(); },
        isPanning: function () { return !!(inst() && inst().zoom.isPanning()); }
      }
    };
  }, []);

  return createElement('div', { ref: elRef, className: props.className, style: props.style });
});
