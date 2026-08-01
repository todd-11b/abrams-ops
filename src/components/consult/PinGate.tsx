import { ProductionPinGate } from '../production/PinGate';

interface PinGateProps { onUnlock: () => void }

export const PinGate = ({ onUnlock }: PinGateProps) => (
  <ProductionPinGate onUnlock={() => onUnlock()} />
);
