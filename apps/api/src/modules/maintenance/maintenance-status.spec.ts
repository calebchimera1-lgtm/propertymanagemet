import type { MaintenanceStatus } from '@pm/database';
import {
  STATUS_TRANSITIONS,
  TERMINAL_STATUSES,
  canTransition,
  transitionRefusal,
} from './maintenance-status';

/**
 * The maintenance workflow.
 *
 * These assertions are the definition of the workflow, not a description of it:
 * changing what a request may do next means changing a test that says so.
 */
describe('maintenance status transitions', () => {
  const ALL: MaintenanceStatus[] = [
    'PENDING',
    'ASSIGNED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
  ];

  it('walks the happy path', () => {
    expect(canTransition('PENDING', 'ASSIGNED')).toBe(true);
    expect(canTransition('ASSIGNED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
  });

  it('lets a job start without being assigned first', () => {
    // Somebody fixing it themselves should not have to assign it to themselves
    // before they are allowed to say they have started.
    expect(canTransition('PENDING', 'IN_PROGRESS')).toBe(true);
  });

  it('lets an assigned job go back to pending', () => {
    // Unassignment: the contractor declined, or the person left.
    expect(canTransition('ASSIGNED', 'PENDING')).toBe(true);
  });

  it('refuses a jump straight to completed', () => {
    expect(canTransition('PENDING', 'COMPLETED')).toBe(false);
    expect(canTransition('ASSIGNED', 'COMPLETED')).toBe(false);
  });

  it('can cancel anything that is still live', () => {
    expect(canTransition('PENDING', 'CANCELLED')).toBe(true);
    expect(canTransition('ASSIGNED', 'CANCELLED')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'CANCELLED')).toBe(true);
  });

  it('treats completed and cancelled as final', () => {
    for (const terminal of TERMINAL_STATUSES) {
      for (const target of ALL) {
        expect(canTransition(terminal, target)).toBe(false);
      }
      expect(STATUS_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it('never allows a transition to itself', () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('explains a refusal in terms an operator can act on', () => {
    expect(transitionRefusal('PENDING', 'COMPLETED')).toMatch(/can move to: assigned, in progress/);
    expect(transitionRefusal('COMPLETED', 'IN_PROGRESS')).toMatch(/cannot be reopened/);
    expect(transitionRefusal('CANCELLED', 'PENDING')).toMatch(/Raise a new request/);
    expect(transitionRefusal('ASSIGNED', 'ASSIGNED')).toMatch(/already assigned/);
  });

  it('lists no transition that is not a real status', () => {
    for (const [from, targets] of Object.entries(STATUS_TRANSITIONS)) {
      for (const target of targets) {
        expect(ALL).toContain(target);
        expect(target).not.toBe(from);
      }
    }
  });
});
