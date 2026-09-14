import { StateMachine } from '@/shared/FSM/StateMachine';
import type { DispenserStatus } from '../utils/parseStatus';

export type { MachineState as DispenserState } from '@/shared/FSM/StateMachine';

export class DispenserStateMachine extends StateMachine<DispenserStatus> {
  constructor() {
    super('[TokenDispenser:FSM]');
  }
}
