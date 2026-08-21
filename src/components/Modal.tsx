import { ReactNode } from 'react';

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="topbar">
          <h2>{title}</h2>
          <button className="secondary" onClick={onClose}>Fechar</button>
        </div>
        {children}
      </div>
    </div>
  );
}
