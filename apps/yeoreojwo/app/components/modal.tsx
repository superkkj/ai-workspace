'use client';

import { useEffect, useId, useRef } from 'react';
import { ArrowLeft, X } from 'lucide-react';

export function Modal({ title, subtitle, children, onClose, onBack, wide = false, busy = false }: {
  title: string; subtitle?: string; children: React.ReactNode; onClose: () => void;
  onBack?: () => void; wide?: boolean; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = oldOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} onClick={e => { if (e.target === e.currentTarget && !busy) { const box=e.currentTarget.getBoundingClientRect(); if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom) onClose(); } }}>
    <div className="modal-header"><div>{onBack && <button type="button" className="text-button back-button" onClick={onBack} disabled={busy}><ArrowLeft size={16}/> 요청으로 돌아가기</button>}<h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button close-button" aria-label="닫기" onClick={onClose} disabled={busy}><X size={21}/></button></div>
    <div className="modal-content">{children}</div>
  </dialog>;
}
