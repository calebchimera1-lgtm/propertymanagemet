import type { MaintenanceStatus } from '@pm/database';

/**
 * The maintenance workflow, as a table rather than a pile of if-statements.
 *
 * COMPLETED and CANCELLED are terminal on purpose. A fault that comes back is a
 * new request: that way each job carries its own cost, its own timeline and its
 * own duration, and the maintenance report can answer "how long did this take"
 * without picking through reopenings.
 */
export const STATUS_TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  PENDING: ['ASSIGNED', 'IN_PROGRESS', 'CANCELLED'],
  // Back to PENDING is unassignment — the person left, the contractor declined.
  ASSIGNED: ['IN_PROGRESS', 'PENDING', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const TERMINAL_STATUSES: MaintenanceStatus[] = ['COMPLETED', 'CANCELLED'];

export function canTransition(from: MaintenanceStatus, to: MaintenanceStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/** Why a transition was refused, in words an operator can act on. */
export function transitionRefusal(from: MaintenanceStatus, to: MaintenanceStatus): string {
  if (from === to) return `This request is already ${LABELS[to]}.`;
  if (TERMINAL_STATUSES.includes(from)) {
    return `A ${LABELS[from]} request cannot be reopened. Raise a new request instead — that keeps each job's cost and timeline its own.`;
  }
  const allowed = STATUS_TRANSITIONS[from].map((status) => LABELS[status]).join(', ');
  return `A ${LABELS[from]} request cannot move straight to ${LABELS[to]}. It can move to: ${allowed}.`;
}

const LABELS: Record<MaintenanceStatus, string> = {
  PENDING: 'pending',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};
