import { useState } from 'react';
import { ConsultApp } from '../../components/consult/ConsultApp';
import { PinGate } from '../../components/consult/PinGate';

import { getStoredActor } from '../../utils/actor';

export default function ConsultPage() {
  const [unlocked, setUnlocked] = useState(() => Boolean(getStoredActor()));

  if (!unlocked) {
    return (
      <PinGate
        onUnlock={() => {
          setUnlocked(true);
        }}
      />
    );
  }

  return <ConsultApp />;
}
