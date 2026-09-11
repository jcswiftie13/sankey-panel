/* 永遠拿到最新一份值的 ref：callback props 走這裡，identity 變了不會讓 effect 重跑、不會重新 attach。 */
import { useRef } from 'react';

export const useLatest = <T>(v: T) => {
  const ref = useRef(v);
  ref.current = v;
  return ref;
};
