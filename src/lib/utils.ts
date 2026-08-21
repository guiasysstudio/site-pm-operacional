export function normalizeEmail(email?: string | null): string {
  return (email || '').trim().toLowerCase();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatDate(date?: string): string {
  if (!date) return '-';
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) return date;
  return `${day}/${month}/${year}`;
}

export function statusLabel(status?: string): string {
  const map: Record<string, string> = {
    pending: 'Pendente',
    approved: 'Aprovado',
    rejected: 'Recusado',
    inactive: 'Inativo',
    active: 'Ativo',
    created: 'Criada',
    list_generated: 'Lista gerada',
    list_published: 'Lista publicada',
    in_progress: 'Em andamento',
    completed: 'Concluída',
    canceled: 'Cancelada'
  };
  return map[status || ''] || status || '-';
}

export function statusBadgeClass(status?: string): string {
  if (['approved', 'active', 'completed'].includes(status || '')) return 'success';
  if (['rejected', 'inactive', 'canceled'].includes(status || '')) return 'danger';
  if (['pending', 'created', 'list_generated', 'list_published', 'in_progress'].includes(status || '')) return 'warning';
  return 'muted';
}
