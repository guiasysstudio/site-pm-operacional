import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  User
} from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import jsPDF from 'jspdf';
import { auth, db } from './lib/firebase';
import { formatDate, normalizeEmail, statusBadgeClass, statusLabel } from './lib/utils';
import { Shell } from './components/Shell';
import { Modal } from './components/Modal';
import './styles.css';

type Operator = { email: string; name: string; status: string; permissions: Record<string, boolean> };
type PMProfile = { authUid: string; email: string; fullName: string; warName: string; registration: string; observations?: string; status: string; rejectionReason?: string };
type Mission = { id?: string; name: string; date: string; time?: string; local?: string; type?: string; slots: number; reserveSlots?: number; description?: string; status: string };
type PMOperation = { id?: string; name?: string; date?: string; description?: string };

function has(op: Operator | null, key: string) {
  return !!op?.permissions?.[key];
}

async function logAction(action: string, details: any = {}) {
  const user = auth.currentUser;
  if (!user) return;
  await addDoc(collection(db, 'audit_logs'), {
    actorUid: user.uid,
    actorEmail: normalizeEmail(user.email),
    actorType: 'operational',
    action,
    details,
    createdAt: serverTimestamp()
  });
}

function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    setBusy(true);

    try {
      // Importante:
      // Não consultamos operational_users antes do login, porque as regras do Firestore
      // bloqueiam leitura sem autenticação. O App autentica primeiro e o App principal
      // valida se o e-mail está liberado/ativo em operational_users.
      if (mode === 'register') {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err: any) {
      const code = err?.code || '';
      const friendly: Record<string, string> = {
        'auth/email-already-in-use': 'Este e-mail já possui acesso criado. Use "Entrar" ou recupere a senha.',
        'auth/invalid-credential': 'E-mail ou senha incorretos.',
        'auth/user-not-found': 'Usuário não encontrado. Use "Primeiro acesso/criar senha".',
        'auth/wrong-password': 'Senha incorreta.',
        'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
        'auth/invalid-email': 'E-mail inválido.',
        'auth/operation-not-allowed': 'Login por e-mail/senha não está habilitado no Firebase Authentication.'
      };
      setMsg(friendly[code] || err?.message || 'Falha no acesso.');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!email) return setMsg('Digite o e-mail primeiro.');
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMsg('E-mail de recuperação enviado, se a conta existir.');
    } catch (err: any) {
      setMsg(err?.message || 'Falha ao enviar recuperação de senha.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <section className="login-hero">
          <div className="brand-mark">OP</div>
          <h1>Painel Operacional</h1>
          <p>Acesso restrito a operadores liberados pelo Painel Administrativo.</p>
          <div className="notice">
            Primeiro o ADM libera o e-mail. Depois o operador cria a senha no primeiro acesso.
          </div>
        </section>
        <section className="login-form">
          <h2>{mode === 'login' ? 'Entrar' : 'Primeiro acesso'}</h2>
          <form className="form-grid" onSubmit={submit}>
            <label>E-mail liberado pelo ADM
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>Senha
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
            </label>
            {msg && <div className="notice">{msg}</div>}
            <button disabled={busy}>{busy ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar senha e entrar'}</button>
          </form>
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="ghost" disabled={busy} onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'Primeiro acesso/criar senha' : 'Já tenho acesso'}
            </button>
            <button className="ghost" disabled={busy} onClick={reset}>Recuperar senha</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Dashboard({ operator }: { operator: Operator }) {
  const perms = Object.entries(operator.permissions || {}).filter(([, v]) => v);
  return (
    <section className="card">
      <h2>Bem-vindo, {operator.name}</h2>
      <p>Seu acesso é controlado por permissões liberadas no Painel Administrativo.</p>
      <div className="grid three">
        <div className="card"><h3>Permissões ativas</h3><strong>{perms.length}</strong></div>
        <div className="card"><h3>Status</h3><span className="badge success">Ativo</span></div>
        <div className="card"><h3>Site</h3><strong>oper.guiasys.online</strong></div>
      </div>
    </section>
  );
}

function PMsPage({ operator }: { operator: Operator }) {
  const [pms, setPms] = useState<PMProfile[]>([]);
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<PMProfile | null>(null);
  const [details, setDetails] = useState<{ pm: PMProfile; operations: PMOperation[] } | null>(null);
  const [filter, setFilter] = useState('');

  async function load() {
    const snap = await getDocs(query(collection(db, 'pm_profiles'), orderBy('updatedAt', 'desc')));
    setPms(snap.docs.map((d) => ({ ...(d.data() as Omit<PMProfile, 'authUid'>), authUid: d.id })));
  }

  useEffect(() => { load(); }, []);

  const filteredPms = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return pms;
    return pms.filter((pm) =>
      `${pm.fullName || ''} ${pm.warName || ''} ${pm.registration || ''} ${pm.email || ''}`.toLowerCase().includes(term)
    );
  }, [pms, filter]);

  const counts = useMemo(() => ({
    total: pms.length,
    pending: pms.filter((pm) => pm.status === 'pending').length,
    approved: pms.filter((pm) => pm.status === 'approved').length,
    rejected: pms.filter((pm) => pm.status === 'rejected').length,
    inactive: pms.filter((pm) => pm.status === 'inactive').length
  }), [pms]);

  function isComplete(pm: PMProfile) {
    return !!pm.fullName && !!pm.warName && !!pm.registration;
  }

  async function openDetails(pm: PMProfile) {
    const ops = await getDocs(query(collection(db, 'pm_profiles', pm.authUid, 'operations'), orderBy('date', 'desc')));
    setDetails({
      pm,
      operations: ops.docs.map((d) => ({ id: d.id, ...d.data() } as PMOperation))
    });
    await logAction('pm_profile_viewed', { pmUid: pm.authUid, pmEmail: pm.email });
  }

  async function setStatus(pm: PMProfile, status: string, extra: any = {}) {
    await updateDoc(doc(db, 'pm_profiles', pm.authUid), {
      status,
      ...extra,
      updatedAt: serverTimestamp()
    });
    await addDoc(collection(db, 'notifications'), {
      recipientUid: pm.authUid,
      recipientEmail: pm.email,
      title: status === 'approved' ? 'Cadastro aprovado' : status === 'rejected' ? 'Cadastro recusado' : 'Situação atualizada',
      message: status === 'rejected' ? `Motivo: ${extra.rejectionReason || 'Não informado.'}` : `Seu cadastro está com status: ${statusLabel(status)}.`,
      recipientType: 'pm',
      createdAt: serverTimestamp(),
      read: false
    });
    await logAction('pm_status_changed', { pmUid: pm.authUid, pmEmail: pm.email, status, extra });
    setSelected(null);
    setReason('');
    load();
  }

  return (
    <section className="card">
      <div className="topbar">
        <div>
          <h2>PMs cadastrados</h2>
          <small>Consulta, aprovação, recusa e conferência de cadastro.</small>
        </div>
        <button className="secondary" onClick={load}>Atualizar</button>
      </div>

      <div className="grid five" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <div className="card"><h3>Total</h3><strong>{counts.total}</strong></div>
        <div className="card"><h3>Pendentes</h3><strong>{counts.pending}</strong></div>
        <div className="card"><h3>Aprovados</h3><strong>{counts.approved}</strong></div>
        <div className="card"><h3>Recusados</h3><strong>{counts.rejected}</strong></div>
        <div className="card"><h3>Inativos</h3><strong>{counts.inactive}</strong></div>
      </div>

      <label style={{ marginBottom: 14 }}>Buscar por nome, nome de guerra, matrícula ou e-mail
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Digite para filtrar..." />
      </label>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Nome de guerra</th><th>Nome completo</th><th>Matrícula</th><th>Cadastro</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>
            {filteredPms.map((pm) => (
              <tr key={pm.authUid}>
                <td>{pm.warName || '-'}</td>
                <td>{has(operator, 'viewPMFullProfile') ? pm.fullName : '-'}</td>
                <td>{pm.registration || '-'}</td>
                <td><span className={`badge ${isComplete(pm) ? 'success' : 'danger'}`}>{isComplete(pm) ? 'Completo' : 'Incompleto'}</span></td>
                <td><span className={`badge ${statusBadgeClass(pm.status)}`}>{statusLabel(pm.status)}</span></td>
                <td className="actions">
                  {has(operator, 'viewPMFullProfile') && <button className="secondary" onClick={() => openDetails(pm)}>Ver cadastro</button>}
                  {has(operator, 'approveRejectPM') && <button className="success" disabled={!isComplete(pm)} onClick={() => setStatus(pm, 'approved', { approvedAt: serverTimestamp(), approvedBy: operator.email })}>Aprovar</button>}
                  {has(operator, 'approveRejectPM') && <button className="danger" onClick={() => setSelected(pm)}>Recusar</button>}
                  {has(operator, 'activateInactivatePM') && pm.status !== 'inactive' && <button className="warning" onClick={() => setStatus(pm, 'inactive', { inactivatedAt: serverTimestamp(), inactivatedBy: operator.email })}>Inativar</button>}
                  {has(operator, 'activateInactivatePM') && pm.status === 'inactive' && <button className="secondary" onClick={() => setStatus(pm, 'approved', { reactivatedAt: serverTimestamp(), reactivatedBy: operator.email })}>Reativar</button>}
                </td>
              </tr>
            ))}
            {!filteredPms.length && <tr><td colSpan={6} className="empty">Nenhum PM encontrado.</td></tr>}
          </tbody>
        </table>
      </div>

      {details && (
        <Modal title={`Cadastro do PM - ${details.pm.warName || details.pm.fullName}`} onClose={() => setDetails(null)}>
          <div className="grid two">
            <div>
              <p><strong>Nome completo:</strong> {details.pm.fullName || '-'}</p>
              <p><strong>Nome de guerra:</strong> {details.pm.warName || '-'}</p>
              <p><strong>Matrícula:</strong> {details.pm.registration || '-'}</p>
              <p><strong>E-mail:</strong> {details.pm.email || '-'}</p>
              <p><strong>Status:</strong> <span className={`badge ${statusBadgeClass(details.pm.status)}`}>{statusLabel(details.pm.status)}</span></p>
              {details.pm.rejectionReason && <div className="notice danger"><strong>Motivo da recusa:</strong><br />{details.pm.rejectionReason}</div>}
            </div>
            <div>
              <h3>Observação do PM</h3>
              <p>{details.pm.observations || 'Sem observação.'}</p>
            </div>
          </div>

          <h3>Missões/operações informadas</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>Data</th><th>Descrição</th></tr></thead>
              <tbody>
                {details.operations.map((op) => (
                  <tr key={op.id || `${op.name}-${op.date}`}>
                    <td>{op.name || '-'}</td>
                    <td>{formatDate(op.date)}</td>
                    <td>{op.description || '-'}</td>
                  </tr>
                ))}
                {!details.operations.length && <tr><td colSpan={3} className="empty">Nenhuma missão/operação informada.</td></tr>}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {selected && (
        <Modal title={`Recusar cadastro - ${selected.warName || selected.fullName}`} onClose={() => setSelected(null)}>
          <div className="form-grid">
            <div className="notice danger">
              O PM receberá uma notificação com o motivo e poderá corrigir o cadastro. Ao reenviar, o status volta para Pendente.
            </div>
            <label>Motivo da recusa
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
            </label>
            <button className="danger" disabled={!reason.trim()} onClick={() => setStatus(selected, 'rejected', { rejectionReason: reason.trim(), rejectedAt: serverTimestamp(), rejectedBy: operator.email })}>Confirmar recusa</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function MissionsPage({ operator }: { operator: Operator }) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [editing, setEditing] = useState<Mission | null>(null);

  async function load() {
    const snap = await getDocs(query(collection(db, 'missions'), orderBy('date', 'desc')));
    setMissions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Mission) })));
  }

  useEffect(() => { load(); }, []);

  async function saveMission(m: Mission) {
    if (m.id) {
      await updateDoc(doc(db, 'missions', m.id), { ...m, updatedAt: serverTimestamp() });
      await logAction('mission_updated', { missionId: m.id });
    } else {
      await addDoc(collection(db, 'missions'), { ...m, status: 'created', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: operator.email });
      await logAction('mission_created', { name: m.name });
    }
    setEditing(null);
    load();
  }

  async function changeStatus(m: Mission, status: string) {
    if (!m.id) return;
    await updateDoc(doc(db, 'missions', m.id), { status, updatedAt: serverTimestamp() });
    await logAction('mission_status_changed', { missionId: m.id, status });
    load();
  }

  return (
    <section className="card">
      <div className="topbar">
        <h2>Missões</h2>
        {has(operator, 'createMission') && <button onClick={() => setEditing({ name: '', date: '', slots: 1, status: 'created' })}>Criar missão</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Missão</th><th>Data</th><th>Vagas</th><th>Reservas</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>
            {missions.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td><td>{formatDate(m.date)}</td><td>{m.slots}</td><td>{m.reserveSlots || 0}</td>
                <td><span className={`badge ${statusBadgeClass(m.status)}`}>{statusLabel(m.status)}</span></td>
                <td className="actions">
                  {has(operator, 'editMission') && <button className="secondary" onClick={() => setEditing(m)}>Editar</button>}
                  {has(operator, 'completeMission') && <button className="success" onClick={() => changeStatus(m, 'completed')}>Concluir</button>}
                  {has(operator, 'cancelMission') && <button className="danger" onClick={() => changeStatus(m, 'canceled')}>Cancelar</button>}
                </td>
              </tr>
            ))}
            {!missions.length && <tr><td colSpan={6} className="empty">Nenhuma missão cadastrada.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <MissionModal mission={editing} onClose={() => setEditing(null)} onSave={saveMission} />}
    </section>
  );
}

function MissionModal({ mission, onClose, onSave }: { mission: Mission; onClose: () => void; onSave: (m: Mission) => void }) {
  const [m, setM] = useState<Mission>(mission);
  return (
    <Modal title={m.id ? 'Editar missão' : 'Criar missão'} onClose={onClose}>
      <div className="form-grid">
        <label>Nome da missão *
          <input value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} required />
        </label>
        <div className="grid three">
          <label>Data *
            <input type="date" lang="pt-BR" value={m.date} onChange={(e) => setM({ ...m, date: e.target.value })} required />
          </label>
          <label>Horário
            <input type="time" value={m.time || ''} onChange={(e) => setM({ ...m, time: e.target.value })} />
          </label>
          <label>Tipo
            <input value={m.type || ''} onChange={(e) => setM({ ...m, type: e.target.value })} />
          </label>
        </div>
        <label>Local
          <input value={m.local || ''} onChange={(e) => setM({ ...m, local: e.target.value })} />
        </label>
        <div className="grid two">
          <label>Quantidade de vagas *
            <input type="number" min={1} value={m.slots} onChange={(e) => setM({ ...m, slots: Number(e.target.value) })} required />
          </label>
          <label>Quantidade de reservas
            <input type="number" min={0} value={m.reserveSlots || 0} onChange={(e) => setM({ ...m, reserveSlots: Number(e.target.value) })} />
          </label>
        </div>
        <label>Descrição/observação
          <textarea value={m.description || ''} onChange={(e) => setM({ ...m, description: e.target.value })} />
        </label>
        <button onClick={() => onSave(m)} disabled={!m.name || !m.date || !m.slots}>Salvar missão</button>
      </div>
    </Modal>
  );
}

async function getPmOperations(pmUid: string) {
  const manual = await getDocs(collection(db, 'pm_profiles', pmUid, 'operations'));
  const confirmed = await getDocs(query(collection(db, 'mission_participations'), where('pmUid', '==', pmUid)));
  const ops = [
    ...manual.docs.map((d) => d.data()),
    ...confirmed.docs.map((d) => d.data())
  ];
  return ops;
}

async function getLatestEvaluation(pmUid: string) {
  const snap = await getDocs(query(collection(db, 'pm_evaluations'), where('pmUid', '==', pmUid), orderBy('period', 'desc')));
  return snap.docs[0]?.data()?.finalScore || 5;
}

function daysSince(date: string) {
  const d = new Date(date + 'T00:00:00');
  const diff = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function currentYear() {
  return new Date().getFullYear();
}

function completePM(pm: PMProfile) {
  return !!pm.fullName && !!pm.warName && !!pm.registration;
}

function SelectionPage({ operator }: { operator: Operator }) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [missionId, setMissionId] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const selectedMission = missions.find((m) => m.id === missionId);

  useEffect(() => {
    getDocs(query(collection(db, 'missions'), orderBy('date', 'desc'))).then((snap) => setMissions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Mission) }))));
  }, []);

  async function generate() {
    if (!selectedMission) return;
    const pmSnap = await getDocs(query(collection(db, 'pm_profiles'), where('status', '==', 'approved')));
    const pms = pmSnap.docs.map((d) => ({ ...(d.data() as Omit<PMProfile, 'authUid'>), authUid: d.id })).filter(completePM);
    const base = [];
    for (const pm of pms) {
      const ops = await getPmOperations(pm.authUid);
      const lastDate = ops.map((o: any) => o.date || o.missionDate).filter(Boolean).sort().pop();
      const days = lastDate ? daysSince(lastDate) : 999;
      const yearOps = ops.filter((o: any) => String(o.date || o.missionDate || '').startsWith(String(currentYear()))).length;
      const evalScore = await getLatestEvaluation(pm.authUid);
      base.push({ pm, days, yearOps, evalScore });
    }
    const maxDays = Math.max(1, ...base.map((b) => b.days));
    const maxYearOps = Math.max(1, ...base.map((b) => b.yearOps));
    const ranked = base.map((b) => {
      const timeScore = (b.days / maxDays) * 100;
      const qtyScore = (1 - b.yearOps / maxYearOps) * 100;
      const evalScore = b.evalScore * 10;
      const ipo = timeScore * 0.7 + qtyScore * 0.2 + evalScore * 0.1;
      return { ...b, timeScore, qtyScore, ipo };
    }).sort((a, b) => b.ipo - a.ipo || b.days - a.days || a.yearOps - b.yearOps || b.evalScore - a.evalScore);
    setRows(ranked);
    await logAction('selection_generated_preview', { missionId });
  }

  async function saveList(publish = false) {
    if (!selectedMission || !rows.length) return;
    const selected = rows.slice(0, selectedMission.slots);
    const reserves = selectedMission.reserveSlots ? rows.slice(selectedMission.slots, selectedMission.slots + selectedMission.reserveSlots) : [];
    const ref = await addDoc(collection(db, 'mission_lists'), {
      missionId: selectedMission.id,
      missionName: selectedMission.name,
      status: publish ? 'published' : 'saved',
      selected: selected.map((r, index) => ({ position: index + 1, pmUid: r.pm.authUid, warName: r.pm.warName, registration: r.pm.registration, ipo: Number(r.ipo.toFixed(2)) })),
      reserves: reserves.map((r, index) => ({ position: index + 1, pmUid: r.pm.authUid, warName: r.pm.warName, registration: r.pm.registration, ipo: Number(r.ipo.toFixed(2)) })),
      createdBy: operator.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'missions', selectedMission.id!), { status: publish ? 'list_published' : 'list_generated', updatedAt: serverTimestamp() });
    if (publish) {
      for (const r of selected) {
        await addDoc(collection(db, 'notifications'), {
          recipientUid: r.pm.authUid,
          recipientEmail: r.pm.email,
          recipientType: 'pm',
          title: 'Você foi selecionado para uma missão',
          message: `Você foi selecionado para a missão ${selectedMission.name}, em ${formatDate(selectedMission.date)}.`,
          missionId: selectedMission.id,
          createdAt: serverTimestamp(),
          read: false
        });
      }
    }
    await logAction(publish ? 'mission_list_published' : 'mission_list_saved', { missionId, listId: ref.id });
    alert(publish ? 'Lista publicada.' : 'Lista salva.');
  }

  function exportPDF() {
    if (!selectedMission || !rows.length) return;
    const docPdf = new jsPDF();
    docPdf.text('Lista da Missão', 14, 16);
    docPdf.text(`Missão: ${selectedMission.name}`, 14, 28);
    docPdf.text(`Data: ${formatDate(selectedMission.date)}`, 14, 36);
    docPdf.text('Selecionados:', 14, 50);
    rows.slice(0, selectedMission.slots).forEach((r, i) => docPdf.text(`${i + 1}. ${r.pm.warName} - Matrícula ${r.pm.registration}`, 18, 60 + i * 8));
    const start = 68 + selectedMission.slots * 8;
    if (selectedMission.reserveSlots) {
      docPdf.text('Reservas:', 14, start);
      rows.slice(selectedMission.slots, selectedMission.slots + selectedMission.reserveSlots).forEach((r, i) => docPdf.text(`${i + 1}. ${r.pm.warName} - Matrícula ${r.pm.registration}`, 18, start + 10 + i * 8));
    }
    docPdf.save(`lista-${selectedMission.name}.pdf`);
    logAction('mission_list_exported_pdf', { missionId });
  }

  return (
    <section className="card">
      <h2>Selecionados</h2>
      <div className="grid two">
        <label>Missão cadastrada
          <select value={missionId} onChange={(e) => setMissionId(e.target.value)}>
            <option value="">Selecione...</option>
            {missions.map((m) => <option key={m.id} value={m.id}>{m.name} — {formatDate(m.date)}</option>)}
          </select>
        </label>
        <div className="actions" style={{ alignSelf: 'end' }}>
          {has(operator, 'generateList') && <button onClick={generate} disabled={!missionId}>Gerar selecionados</button>}
          {has(operator, 'exportList') && <button className="secondary" onClick={exportPDF} disabled={!rows.length}>PDF</button>}
        </div>
      </div>
      {rows.length > 0 && (
        <>
          <div className="actions" style={{ margin: '14px 0' }}>
            <button onClick={() => saveList(false)}>Salvar lista</button>
            {has(operator, 'publishList') && <button className="success" onClick={() => saveList(true)}>Publicar lista</button>}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pos.</th><th>PM</th><th>Matrícula</th><th>IPO</th><th>Dias s/ op.</th><th>Op. no ano</th><th>Tipo</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.pm.authUid}>
                    <td>{i + 1}</td>
                    <td>{r.pm.warName}</td>
                    <td>{r.pm.registration}</td>
                    <td>{r.ipo.toFixed(2)}</td>
                    <td>{r.days}</td>
                    <td>{r.yearOps}</td>
                    <td>{selectedMission && i < selectedMission.slots ? 'Selecionado' : selectedMission?.reserveSlots && i < selectedMission.slots + selectedMission.reserveSlots ? 'Reserva' : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function CriteriaPage({ operator }: { operator: Operator }) {
  const [items, setItems] = useState<any[]>([]);
  const [name, setName] = useState('');
  async function load() {
    const snap = await getDocs(query(collection(db, 'evaluation_criteria'), orderBy('order', 'asc')));
    setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
  useEffect(() => { load(); }, []);
  async function add() {
    if (!name.trim()) return;
    const id = name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_');
    await setDoc(doc(db, 'evaluation_criteria', id), { name: name.trim(), description: '', active: true, minScore: 1, maxScore: 10, order: items.length + 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await logAction('criterion_created', { id, name });
    setName('');
    load();
  }
  return (
    <section className="card">
      <h2>Critérios de avaliação</h2>
      {has(operator, 'manageCriteria') && (
        <div className="actions">
          <input placeholder="Novo critério" value={name} onChange={(e) => setName(e.target.value)} />
          <button onClick={add}>Adicionar</button>
        </div>
      )}
      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table><thead><tr><th>Ordem</th><th>Critério</th><th>Ativo</th></tr></thead><tbody>
          {items.map((i) => <tr key={i.id}><td>{i.order}</td><td>{i.name}</td><td>{i.active ? 'Sim' : 'Não'}</td></tr>)}
        </tbody></table>
      </div>
    </section>
  );
}

function MessagesPage({ operator }: { operator: Operator }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [pms, setPms] = useState<PMProfile[]>([]);
  const [recipient, setRecipient] = useState('all');
  const [text, setText] = useState('');
  async function load() {
    const msgSnap = await getDocs(query(collection(db, 'messages'), orderBy('createdAt', 'desc')));
    setMessages(msgSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    const pmSnap = await getDocs(query(collection(db, 'pm_profiles'), where('status', '==', 'approved')));
    setPms(pmSnap.docs.map((d) => ({ ...(d.data() as Omit<PMProfile, 'authUid'>), authUid: d.id })));
  }
  useEffect(() => { if (has(operator, 'viewMessages')) load(); }, []);
  async function send() {
    if (!text.trim()) return;
    if (recipient === 'all') {
      await addDoc(collection(db, 'messages'), { senderUid: auth.currentUser?.uid, senderEmail: operator.email, senderType: 'operational', recipientType: 'all_pms', text, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    } else {
      const pm = pms.find((p) => p.authUid === recipient);
      await addDoc(collection(db, 'messages'), { senderUid: auth.currentUser?.uid, senderEmail: operator.email, senderType: 'operational', recipientType: 'pm', recipientUid: recipient, recipientEmail: pm?.email, text, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    await logAction('message_sent', { recipient });
    setText('');
    load();
  }
  return (
    <section className="card">
      <h2>Mensagens</h2>
      {(has(operator, 'sendMessageToPM') || has(operator, 'sendMessageToAll')) && (
        <div className="card" style={{ background: 'var(--surface-soft)' }}>
          <div className="grid two">
            <label>Destinatário
              <select value={recipient} onChange={(e) => setRecipient(e.target.value)}>
                {has(operator, 'sendMessageToAll') && <option value="all">Todos os PMs aprovados</option>}
                {has(operator, 'sendMessageToPM') && pms.map((p) => <option key={p.authUid} value={p.authUid}>{p.warName} — {p.registration}</option>)}
              </select>
            </label>
            <label>Mensagem
              <input value={text} onChange={(e) => setText(e.target.value)} />
            </label>
          </div>
          <button onClick={send} style={{ marginTop: 12 }}>Enviar</button>
        </div>
      )}
      <div className="table-wrap">
        <table><thead><tr><th>De</th><th>Para</th><th>Mensagem</th></tr></thead><tbody>
          {messages.map((m) => <tr key={m.id}><td>{m.senderEmail || m.senderType}</td><td>{m.recipientEmail || m.recipientType}</td><td>{m.text}</td></tr>)}
        </tbody></table>
      </div>
    </section>
  );
}


function AccountPage({ operator, user }: { operator: Operator; user: User }) {
  const activePermissions = Object.entries(operator.permissions || {}).filter(([, value]) => value);
  return (
    <section className="card">
      <h2>Minha conta operacional</h2>
      <div className="grid two">
        <div>
          <p><strong>Nome:</strong> {operator.name || '-'}</p>
          <p><strong>E-mail:</strong> {operator.email}</p>
          <p><strong>UID Firebase:</strong> {user.uid}</p>
          <p><strong>Status:</strong> <span className={`badge ${statusBadgeClass(operator.status)}`}>{statusLabel(operator.status)}</span></p>
          <div className="notice">As funções aparecem no menu conforme as permissões liberadas pelo Painel Administrativo.</div>
        </div>
        <div>
          <h3>Permissões ativas</h3>
          {activePermissions.length ? (
            <ul>{activePermissions.map(([key]) => <li key={key}>{key}</li>)}</ul>
          ) : (
            <p>Nenhuma permissão operacional ativa.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [operator, setOperator] = useState<Operator | null | undefined>(undefined);
  const [page, setPage] = useState('dashboard');

  async function loadOperator(current: User) {
    const email = normalizeEmail(current.email);
    const snap = await getDoc(doc(db, 'operational_users', email));
    if (snap.exists() && snap.data().status === 'active') {
      setOperator({ ...(snap.data() as Operator), email });
    } else {
      setOperator(null);
    }
  }

  useEffect(() => {
    return onAuthStateChanged(auth, async (current) => {
      setUser(current);
      if (current) await loadOperator(current);
      else setOperator(undefined);
    });
  }, []);

  if (!user) return <LoginPage />;
  if (operator === undefined) return <div className="login-page"><div className="card">Carregando...</div></div>;
  if (!operator) return (
    <div className="login-page">
      <div className="card">
        <h2>Acesso não autorizado</h2>
        <p>Esta conta entrou no Firebase, mas o e-mail não está liberado como operador ativo em <strong>operational_users</strong>.</p>
        <p><strong>E-mail atual:</strong> {user.email}</p>
        <button onClick={() => signOut(auth)}>Sair e tentar outro e-mail</button>
      </div>
    </div>
  );

  const nav = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'pms', label: 'PMs cadastrados', visible: has(operator, 'approveRejectPM') || has(operator, 'activateInactivatePM') || has(operator, 'viewPMFullProfile') },
    { key: 'missions', label: 'Missões', visible: has(operator, 'createMission') || has(operator, 'editMission') || has(operator, 'deleteMission') },
    { key: 'selection', label: 'Selecionados', visible: has(operator, 'generateList') },
    { key: 'criteria', label: 'Critérios', visible: has(operator, 'manageCriteria') || has(operator, 'evaluatePM') },
    { key: 'messages', label: 'Mensagens', visible: has(operator, 'viewMessages') || has(operator, 'sendMessageToPM') || has(operator, 'sendMessageToAll') },
    { key: 'account', label: 'Minha conta' }
  ];

  return (
    <Shell title="Painel Operacional" subtitle="oper.guiasys.online" nav={nav} current={page} onNavigate={setPage} userLabel={operator.name || user.email || 'Operador'} onLogout={() => signOut(auth)}>
      {page === 'dashboard' && <Dashboard operator={operator} />}
      {page === 'pms' && <PMsPage operator={operator} />}
      {page === 'missions' && <MissionsPage operator={operator} />}
      {page === 'selection' && <SelectionPage operator={operator} />}
      {page === 'criteria' && <CriteriaPage operator={operator} />}
      {page === 'messages' && <MessagesPage operator={operator} />}
      {page === 'account' && <AccountPage operator={operator} user={user} />}
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
